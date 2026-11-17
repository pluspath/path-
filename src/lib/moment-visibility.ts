import { supabaseAdmin } from "../supabase";
import { getBlockedIds } from "./blocks";
import { getDeletionHiddenUserIds } from "./account-deletion";

export type MomentAudience = "public" | "friends" | "close" | "private";

export type MomentVisibilityContext = {
  /** Accepted friends of the viewer. */
  friendIds: Set<string>;
  /** Authors who starred the viewer as a close friend. */
  closeAuthorIds: Set<string>;
  blockedIds: Set<string>;
  deletionHiddenIds: Set<string>;
};

export function normalizeAudience(raw: string | null | undefined): MomentAudience {
  if (raw === "public" || raw === "private" || raw === "close" || raw === "friends") return raw;
  return "friends";
}

/**
 * Moment visibility is driven ONLY by the Moment's own `audience`.
 * Profile privacy (friends-list visibility, etc.) must NOT hide public Moments.
 */
export function canViewerSeeMoment(
  viewerId: string | null | undefined,
  post: { user_id?: string; userId?: string; audience?: string | null } | null | undefined,
  ctx: MomentVisibilityContext,
): boolean {
  if (!viewerId || !post) return false;
  const authorId = post.user_id ?? post.userId;
  if (!authorId) return false;
  if (viewerId === authorId) return true;
  if (ctx.blockedIds.has(authorId)) return false;
  if (ctx.deletionHiddenIds.has(authorId)) return false;

  const audience = normalizeAudience(post.audience);
  if (audience === "public") return true;
  if (audience === "private") return false;
  if (audience === "close") return ctx.closeAuthorIds.has(authorId);
  return ctx.friendIds.has(authorId);
}

async function loadFriendIds(viewerId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${viewerId},receiver_id.eq.${viewerId}`);
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const other = row.requester_id === viewerId ? row.receiver_id : row.requester_id;
    if (other) ids.add(other);
  }
  return ids;
}

async function loadCloseAuthorIds(viewerId: string): Promise<Set<string>> {
  try {
    let { data, error } = await supabaseAdmin
      .from("close_friends")
      .select("user_id")
      .eq("friend_id", viewerId);
    if (error || !data) {
      ({ data, error } = await supabaseAdmin
        .from("close_friends")
        .select("owner_id")
        .eq("friend_id", viewerId));
      if (error || !data) return new Set();
      return new Set(data.map((r: any) => r.owner_id).filter(Boolean));
    }
    return new Set(data.map((r: any) => r.user_id).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Build the shared visibility context for one authenticated viewer. */
export async function loadMomentVisibilityContext(
  viewerId: string,
): Promise<MomentVisibilityContext> {
  const [friendIds, closeAuthorIds, blocked, deletionHidden] = await Promise.all([
    loadFriendIds(viewerId),
    loadCloseAuthorIds(viewerId),
    getBlockedIds(viewerId),
    getDeletionHiddenUserIds(),
  ]);
  return {
    friendIds,
    closeAuthorIds,
    blockedIds: new Set(blocked),
    deletionHiddenIds: deletionHidden,
  };
}

/**
 * True when the authenticated viewer may see this Moment.
 * Loads friendship/close/block context as needed.
 */
export async function viewerCanAccessMoment(
  viewerId: string | null | undefined,
  post: { user_id?: string; userId?: string; audience?: string | null } | null | undefined,
): Promise<boolean> {
  if (!viewerId || !post) return false;
  const authorId = post.user_id ?? post.userId;
  if (!authorId) return false;
  if (viewerId === authorId) return true;
  const ctx = await loadMomentVisibilityContext(viewerId);
  return canViewerSeeMoment(viewerId, post, ctx);
}

/** Null out nested repath originals the viewer is not allowed to see. */
export function scrubInvisibleOriginals(
  posts: any[],
  viewerId: string | null | undefined,
  ctx: MomentVisibilityContext,
): void {
  for (const p of posts ?? []) {
    if (!p?.original) continue;
    if (!canViewerSeeMoment(viewerId, p.original, ctx)) {
      p.original = null;
    }
  }
}
