"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MediaItem = { index: number; url: string; type: "image" | "video" };

type CommentRow = {
  id: string;
  user_id?: string;
  content?: string;
  created_at?: string;
  updated_at?: string | null;
  moderation_status?: string | null;
  profiles?: {
    id?: string;
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

type PostDetail = {
  id: string;
  user_id?: string;
  type?: string;
  content?: string | null;
  image_url?: string | null;
  location?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  audience?: string | null;
  is_hidden?: boolean;
  is_published?: boolean;
  created_at?: string;
  comment_count?: number;
  media?: MediaItem[];
  mediaCount?: number;
  mediaKind?: string;
  reactionCount?: number;
  viewCount?: number;
  reportCount?: number;
  comments?: CommentRow[];
  commentTotal?: number;
  reports?: { id: string; status?: string; reason?: string; created_at?: string }[];
  profiles?: {
    id?: string;
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
    status?: string | null;
  } | null;
};

export default function PostDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const postId = params?.id;
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeMedia, setActiveMedia] = useState(0);

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: PostDetail }>(`/posts/${postId}`);
      setPost(res.data);
      setActiveMedia(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load post");
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  const media = useMemo(() => post?.media ?? [], [post]);

  async function act(path: string, success: string) {
    if (!postId || busy) return;
    setBusy(true);
    try {
      await api.post(path);
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function deletePost() {
    if (!postId || busy) return;
    if (!confirm(`Permanently delete post ${postId}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/posts/${postId}`);
      toast.success("Post deleted");
      router.push("/posts");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  async function deleteComment(commentId: string) {
    if (busy) return;
    if (!confirm("Delete this comment only? The post will remain.")) return;
    setBusy(true);
    try {
      await api.delete(`/comments/${commentId}`);
      toast.success("Comment deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete comment failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error || !post) return <ErrorState message={error || "Post not found"} />;

  const author = post.profiles;
  const active = media[activeMedia];

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Community"
        title="Post details"
        description={`Inspect and moderate moment ${post.id}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => router.push("/posts")}>
              Back to posts
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={busy}>
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Content</CardTitle>
                <p className="mt-1 text-xs text-slate-500 break-all">{post.id}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant={post.is_published === false ? "muted" : "success"}>
                  {post.is_published === false ? "unpublished" : "published"}
                </Badge>
                {post.is_hidden ? <Badge variant="warning">hidden</Badge> : <Badge variant="info">visible</Badge>}
                <Badge variant="muted">{post.mediaKind || post.type || "moment"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">
                {post.content || "(no text content)"}
              </p>
              <div className="grid gap-2 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                <div>Created: {formatDate(post.created_at)}</div>
                <div>Audience: {post.audience || "—"}</div>
                <div>Location: {post.location || post.location_city || "—"}</div>
                <div>
                  Country: {post.location_country || "—"}
                </div>
                <div>Comments: {formatNumber(post.commentTotal ?? post.comment_count ?? 0)}</div>
                <div>Reactions: {formatNumber(post.reactionCount ?? 0)}</div>
                <div>Views: {formatNumber(post.viewCount ?? 0)}</div>
                <div>Reports: {formatNumber(post.reportCount ?? 0)}</div>
                <div>Media files: {formatNumber(post.mediaCount ?? media.length)}</div>
              </div>

              {hasPermission("posts:write") || hasPermission("posts:delete") ? (
                <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                  {hasPermission("posts:write") && !post.is_hidden ? (
                    <Button disabled={busy} variant="secondary" onClick={() => void act(`/posts/${post.id}/hide`, "Post hidden from feeds")}>
                      Disable / Hide
                    </Button>
                  ) : null}
                  {hasPermission("posts:write") && post.is_hidden ? (
                    <Button disabled={busy} onClick={() => void act(`/posts/${post.id}/unhide`, "Post restored")}>
                      Restore / Unhide
                    </Button>
                  ) : null}
                  {hasPermission("posts:write") && post.is_published === false ? (
                    <Button disabled={busy} onClick={() => void act(`/posts/${post.id}/publish`, "Published")}>
                      Publish
                    </Button>
                  ) : null}
                  {hasPermission("posts:write") && post.is_published !== false ? (
                    <Button disabled={busy} variant="secondary" onClick={() => void act(`/posts/${post.id}/unpublish`, "Unpublished")}>
                      Unpublish
                    </Button>
                  ) : null}
                  {hasPermission("posts:delete") ? (
                    <Button disabled={busy} variant="destructive" onClick={() => void deletePost()}>
                      Delete post
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Media viewer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!media.length ? (
                <p className="text-sm text-slate-500">No media attachments on this post.</p>
              ) : (
                <>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
                    {active?.type === "video" ? (
                      <video
                        key={active.url}
                        src={active.url}
                        controls
                        className="max-h-[28rem] w-full bg-black"
                        preload="metadata"
                      />
                    ) : active?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={active.url}
                        alt="Post media"
                        className="max-h-[28rem] w-full object-contain bg-black"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).alt = "Media unavailable";
                          (e.currentTarget as HTMLImageElement).style.opacity = "0.4";
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {media.map((item, idx) => (
                      <button
                        key={`${item.url}-${idx}`}
                        type="button"
                        onClick={() => setActiveMedia(idx)}
                        className={`overflow-hidden rounded-lg border ${
                          idx === activeMedia
                            ? "border-blue-500 ring-2 ring-blue-200"
                            : "border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        {item.type === "video" ? (
                          <div className="flex h-16 w-16 items-center justify-center bg-slate-900 text-[10px] font-semibold text-white">
                            VIDEO
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.url} alt="" className="h-16 w-16 object-cover" />
                        )}
                      </button>
                    ))}
                  </div>
                  {active?.url ? (
                    <a
                      href={active.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      Open original media
                    </a>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Comments ({formatNumber(post.commentTotal ?? post.comments?.length ?? 0)})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!post.comments?.length ? (
                <p className="text-sm text-slate-500">No comments on this post.</p>
              ) : (
                post.comments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={c.profiles?.avatar_url || "/favicon.ico"}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover bg-slate-200"
                        />
                        <div>
                          <p className="text-sm font-semibold">
                            {c.profiles?.full_name || "Unknown"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {c.profiles?.username ? `@${c.profiles.username}` : c.user_id}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-slate-500">{formatDate(c.created_at)}</span>
                        {c.user_id ? (
                          <Link href={`/users?search=${c.user_id}`} className="text-xs text-blue-600 hover:underline">
                            Open author
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{c.content}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Badge variant="muted">{c.moderation_status || "approved"}</Badge>
                      {hasPermission("comments:delete") ? (
                        <Button size="sm" variant="destructive" disabled={busy} onClick={() => void deleteComment(c.id)}>
                          Delete comment
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publisher</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={author?.avatar_url || "/favicon.ico"}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover bg-slate-200"
                />
                <div>
                  <p className="font-semibold">{author?.full_name || "Unknown"}</p>
                  <p className="text-sm text-slate-500">
                    {author?.username ? `@${author.username}` : "—"}
                  </p>
                </div>
              </div>
              <div className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <p className="break-all">User ID: {post.user_id || author?.id || "—"}</p>
                <p>Status: {author?.status || "—"}</p>
              </div>
              {post.user_id ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/users?search=${post.user_id}`}>Open user profile</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Related reports</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!post.reports?.length ? (
                <p className="text-sm text-slate-500">No reports reference this post.</p>
              ) : (
                post.reports.map((r) => (
                  <Link
                    key={r.id}
                    href={`/reports/${r.id}`}
                    className="block rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={r.status === "open" ? "danger" : "muted"}>{r.status || "—"}</Badge>
                      <span className="text-xs text-slate-500">{formatDate(r.created_at)}</span>
                    </div>
                    <p className="mt-1 text-sm">{r.reason || "Report"}</p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
