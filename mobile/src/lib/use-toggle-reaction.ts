import { useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Post } from '@/lib/types';

type ReactionType = Post['reactions'][number]['type'];

/**
 * Debounced, race-condition-safe reaction toggle.
 *
 * - UI updates instantly on every tap (optimistic).
 * - API call is debounced: only the LAST tap in a rapid burst hits the server.
 * - A generation counter ensures a stale in-flight response never overwrites
 *   a newer optimistic state.
 * - Snapshot is taken once per burst and only rolled back on a real error.
 * - Invalidation only fires after the burst fully settles.
 */
export function useToggleReaction(queryKey: readonly unknown[], currentUserId: string) {
  const queryClient = useQueryClient();

  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const generations = useRef<Map<string, number>>(new Map());
  const snapshots = useRef<Map<string, Post[]>>(new Map());
  const mountedRef = useRef(true);
  // Keep a stable ref to the query key so the callback doesn't need it as a dep
  const qkRef = useRef(queryKey);
  qkRef.current = queryKey;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);

  return useCallback(
    ({ postId, type }: { postId: string; type: string }) => {
      const qk = qkRef.current;

      // Cancel the pending debounce for this post (collapse rapid taps)
      const existing = timers.current.get(postId);
      if (existing) clearTimeout(existing);

      // Snapshot the pre-burst state once; reused for rollback if the whole burst errors
      if (!snapshots.current.has(postId)) {
        snapshots.current.set(postId, queryClient.getQueryData<Post[]>(qk) ?? []);
      }

      // Cancel any background refetch so it doesn't stomp the optimistic state
      queryClient.cancelQueries({ queryKey: qk });

      // Increment generation — lets us discard responses from superseded calls
      const gen = (generations.current.get(postId) ?? 0) + 1;
      generations.current.set(postId, gen);

      // Immediate optimistic update
      queryClient.setQueryData<Post[]>(qk, (old = []) =>
        old.map((p) => {
          if (p.id !== postId) return p;
          const hit = p.reactions.find((r) => r.userId === currentUserId);
          let reactions: Post['reactions'];
          if (hit?.type === type) {
            // Same emoji → toggle off
            reactions = p.reactions.filter((r) => r.userId !== currentUserId);
          } else if (hit) {
            // Different emoji → swap
            reactions = p.reactions.map((r) =>
              r.userId === currentUserId ? { ...r, type: type as ReactionType } : r
            );
          } else {
            // No prior reaction → add
            reactions = [...p.reactions, { userId: currentUserId, type: type as ReactionType }];
          }
          return { ...p, reactions };
        })
      );

      // Debounce: only the last tap within 350 ms actually calls the server
      const timer = setTimeout(async () => {
        timers.current.delete(postId);
        try {
          const data = await api.post<{ reactions: { userId: string; type: string }[] }>(
            `/api/posts/${postId}/reactions`,
            { type }
          );
          // Apply server truth only if no newer tap has superseded this call
          if (mountedRef.current && generations.current.get(postId) === gen) {
            queryClient.setQueryData<Post[]>(qk, (old = []) =>
              old.map((p) =>
                p.id === postId ? { ...p, reactions: data.reactions as Post['reactions'] } : p
              )
            );
          }
        } catch {
          // Real network/server error — roll back to pre-burst snapshot
          if (mountedRef.current && generations.current.get(postId) === gen) {
            const snapshot = snapshots.current.get(postId);
            if (snapshot) queryClient.setQueryData(qk, snapshot);
          }
        } finally {
          // Clean up and invalidate only once the burst is fully done
          if (mountedRef.current && generations.current.get(postId) === gen) {
            generations.current.delete(postId);
            snapshots.current.delete(postId);
            queryClient.invalidateQueries({ queryKey: qk });
          }
        }
      }, 350);

      timers.current.set(postId, timer);
    },
    [currentUserId, queryClient]
  );
}
