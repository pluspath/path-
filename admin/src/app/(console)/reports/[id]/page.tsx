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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Profile = {
  id?: string;
  username?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type MediaItem = { index?: number; url: string; type: string };

type PostPayload = {
  id?: string;
  user_id?: string;
  content?: string | null;
  created_at?: string | null;
  audience?: string | null;
  location?: string | null;
  is_hidden?: boolean;
  is_published?: boolean;
  media?: MediaItem[];
  mediaCount?: number;
  mediaKind?: string;
  reactionCount?: number;
  viewCount?: number;
  commentCount?: number;
  profiles?: Profile | null;
};

type ReportDetail = {
  id: string;
  status?: string | null;
  target_type?: string;
  target_id?: string;
  reason?: string | null;
  details?: string | null;
  resolution_note?: string | null;
  reporter_user_id?: string | null;
  reported_user_id?: string | null;
  reported_post_id?: string | null;
  created_at?: string;
  updated_at?: string | null;
  resolved_at?: string | null;
  reporter?: Profile | null;
  reportedUser?: Profile | null;
  target?: {
    available?: boolean;
    kind?: string;
    message?: string;
    reportedUserId?: string | null;
    post?: PostPayload;
    comment?: {
      id?: string;
      user_id?: string;
      content?: string | null;
      created_at?: string | null;
      profiles?: Profile | null;
    };
    parentPost?: PostPayload;
    user?: Profile;
  };
  audit?: {
    id: string;
    action?: string;
    actor_name?: string | null;
    actor_id?: string | null;
    created_at?: string | null;
  }[];
};

function statusVariant(status?: string | null): "success" | "warning" | "danger" | "muted" {
  if (status === "resolved") return "success";
  if (status === "reviewing") return "warning";
  if (status === "open") return "danger";
  return "muted";
}

function ProfileCard({
  title,
  profile,
  fallbackId,
}: {
  title: string;
  profile?: Profile | null;
  fallbackId?: string | null;
}) {
  const id = profile?.id || fallbackId;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profile?.avatar_url || "/favicon.ico"}
            alt=""
            className="h-12 w-12 rounded-full object-cover bg-slate-200"
          />
          <div className="min-w-0">
            <p className="font-semibold truncate">{profile?.full_name || "Unknown"}</p>
            <p className="text-sm text-slate-500 truncate">
              {profile?.username ? `@${profile.username}` : "—"}
            </p>
          </div>
        </div>
        <div className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <p className="break-all">User ID: {id || "—"}</p>
          <p>Status: {profile?.status || "—"}</p>
          <p>Joined: {formatDate(profile?.created_at)}</p>
        </div>
        {id ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/users?search=${id}`}>Open profile</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MediaViewer({ media }: { media: MediaItem[] }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const item = media[active];

  if (!media.length) {
    return <p className="text-sm text-slate-500">No media attachments on this Moment.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
        {item?.type === "video" ? (
          <video
            key={item.url}
            src={item.url}
            controls
            preload="metadata"
            className="max-h-[28rem] w-full bg-black"
            onError={(e) => {
              e.currentTarget.insertAdjacentHTML(
                "afterend",
                '<p class="p-3 text-sm text-rose-300">Video unavailable or expired.</p>'
              );
            }}
          />
        ) : item?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt="Reported media"
            className="max-h-[28rem] w-full cursor-zoom-in object-contain bg-black"
            onClick={() => setLightbox(true)}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).alt = "Media unavailable";
              (e.currentTarget as HTMLImageElement).style.opacity = "0.35";
            }}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {media.map((m, idx) => (
          <button
            key={`${m.url}-${idx}`}
            type="button"
            onClick={() => setActive(idx)}
            className={`overflow-hidden rounded-lg border ${
              idx === active ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200 dark:border-slate-700"
            }`}
          >
            {m.type === "video" ? (
              <div className="flex h-16 w-16 items-center justify-center bg-slate-900 text-[10px] font-semibold text-white">
                VIDEO
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt="" className="h-16 w-16 object-cover" />
            )}
          </button>
        ))}
      </div>
      {item?.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline">
          Open original media
        </a>
      ) : null}
      {lightbox && item?.type !== "video" && item?.url ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}
    </div>
  );
}

function MomentCard({
  title,
  post,
  busy,
  canWrite,
  canDelete,
  onHide,
  onRestore,
  onDelete,
}: {
  title: string;
  post: PostPayload;
  busy: boolean;
  canWrite: boolean;
  canDelete: boolean;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const publisher = post.profiles;
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 break-all text-xs text-slate-500">{post.id}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant={post.is_published === false ? "muted" : "success"}>
            {post.is_published === false ? "unpublished" : "published"}
          </Badge>
          {post.is_hidden ? <Badge variant="warning">hidden</Badge> : <Badge variant="info">visible</Badge>}
          <Badge variant="muted">{post.mediaKind || "text"}</Badge>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={publisher?.avatar_url || "/favicon.ico"}
          alt=""
          className="h-10 w-10 rounded-full object-cover bg-slate-200"
        />
        <div className="min-w-0">
          <p className="font-medium truncate">{publisher?.full_name || "Unknown publisher"}</p>
          <p className="text-xs text-slate-500 truncate">
            {publisher?.username ? `@${publisher.username}` : post.user_id || "—"}
          </p>
        </div>
        {post.user_id ? (
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link href={`/users?search=${post.user_id}`}>Publisher</Link>
          </Button>
        ) : null}
      </div>

      <p className="whitespace-pre-wrap text-sm leading-6">{post.content || "(no text content)"}</p>

      <div className="grid gap-2 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
        <p>Published: {formatDate(post.created_at)}</p>
        <p>Audience: {post.audience || "—"}</p>
        <p>Location: {post.location || "—"}</p>
        <p>Comments: {formatNumber(post.commentCount ?? 0)}</p>
        <p>Reactions: {formatNumber(post.reactionCount ?? 0)}</p>
        <p>Views: {formatNumber(post.viewCount ?? 0)}</p>
      </div>

      <MediaViewer media={post.media || []} />

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        {post.id ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/posts/${post.id}`}>Open full post</Link>
          </Button>
        ) : null}
        {canWrite && post.id && !post.is_hidden ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onHide(post.id!)}>
            Disable / Hide
          </Button>
        ) : null}
        {canWrite && post.id && post.is_hidden ? (
          <Button size="sm" disabled={busy} onClick={() => onRestore(post.id!)}>
            Restore
          </Button>
        ) : null}
        {canDelete && post.id ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => onDelete(post.id!)}>
            Delete Moment
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const reportId = params?.id;
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!reportId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: ReportDetail }>(`/reports/${reportId}`);
      setReport(res.data);
      setNote(res.data.resolution_note || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(next: string) {
    if (!reportId || busy) return;
    setBusy(true);
    try {
      await api.patch(`/reports/${reportId}`, {
        status: next,
        resolution_note: note || undefined,
      });
      toast.success(`Marked as ${next}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function hidePost(postId: string) {
    if (!hasPermission("posts:write") || busy) return;
    setBusy(true);
    try {
      await api.post(`/posts/${postId}/hide`);
      toast.success("Moment hidden from feeds");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Hide failed");
    } finally {
      setBusy(false);
    }
  }

  async function restorePost(postId: string) {
    if (!hasPermission("posts:write") || busy) return;
    setBusy(true);
    try {
      await api.post(`/posts/${postId}/unhide`);
      toast.success("Moment restored");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function deletePost(postId: string) {
    if (!hasPermission("posts:delete") || busy) return;
    if (!confirm(`Permanently delete Moment ${postId}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/posts/${postId}`);
      toast.success("Moment deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteComment(commentId: string) {
    if (!hasPermission("comments:delete") || busy) return;
    if (!confirm("Delete only this reported comment? The Moment will remain.")) return;
    setBusy(true);
    try {
      await api.delete(`/comments/${commentId}`);
      toast.success("Comment deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function suspendUser(userId: string) {
    if (!hasPermission("users:suspend") || busy) return;
    const reason = window.prompt("Suspension reason (optional):");
    if (reason === null) return;
    if (!confirm("Suspend this account? They will not be able to use the app until reactivated.")) return;
    setBusy(true);
    try {
      await api.post(`/users/${userId}/suspend`, { reason: reason.trim() || undefined });
      toast.success("User suspended");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suspend failed");
    } finally {
      setBusy(false);
    }
  }

  async function activateUser(userId: string) {
    if (!hasPermission("users:suspend") || busy) return;
    if (!confirm("Reactivate this account?")) return;
    setBusy(true);
    try {
      await api.post(`/users/${userId}/activate`);
      toast.success("User reactivated");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Activate failed");
    } finally {
      setBusy(false);
    }
  }

  const reportedUserId = useMemo(
    () =>
      report?.reported_user_id ||
      report?.reportedUser?.id ||
      report?.target?.reportedUserId ||
      report?.target?.post?.user_id ||
      report?.target?.comment?.user_id ||
      null,
    [report]
  );

  if (loading) return <LoadingState />;
  if (error || !report) return <ErrorState message={error || "Report not found"} />;

  const target = report.target;
  const moment = target?.post || target?.parentPost;
  const comment = target?.comment;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Community"
        title="Report details"
        description="Inspect the exact reported Moment, people, and take moderation actions"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => router.push("/reports")}>
              Back to reports
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
                <CardTitle className="text-base">Report information</CardTitle>
                <p className="mt-1 break-all text-xs text-slate-500">{report.id}</p>
              </div>
              <Badge variant={statusVariant(report.status)}>{report.status || "—"}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <p>Type: {report.target_type || "—"}</p>
                <p className="break-all">Target ID: {report.target_id || "—"}</p>
                <p>Submitted: {formatDate(report.created_at)}</p>
                <p>Updated: {formatDate(report.updated_at)}</p>
                <p>Resolved: {formatDate(report.resolved_at)}</p>
                <p>Reason: {report.reason || "—"}</p>
              </div>
              <div>
                <p className="mb-1 font-medium">Full description</p>
                <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                  {report.details || "(no additional details)"}
                </p>
              </div>
              {hasPermission("reports:write") ? (
                <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                  <div className="space-y-1.5">
                    <Label>Administrative notes</Label>
                    <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void updateStatus("open")}>
                      Mark New / Open
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void updateStatus("reviewing")}>
                      Under Review
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void updateStatus("resolved")}>
                      Resolve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateStatus("dismissed")}>
                      Dismiss
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Changing report status does not automatically delete content or suspend the user.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reported Moment / content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!target?.available ? (
                <p className="text-sm text-slate-500">{target?.message || "Target unavailable."}</p>
              ) : null}

              {moment ? (
                <MomentCard
                  title={target?.kind === "comment" ? "Parent Moment" : "Reported Moment"}
                  post={moment}
                  busy={busy}
                  canWrite={hasPermission("posts:write")}
                  canDelete={hasPermission("posts:delete")}
                  onHide={(id) => void hidePost(id)}
                  onRestore={(id) => void restorePost(id)}
                  onDelete={(id) => void deletePost(id)}
                />
              ) : null}

              {comment ? (
                <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
                  <p className="text-sm font-semibold">Reported comment</p>
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={comment.profiles?.avatar_url || "/favicon.ico"}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover bg-slate-200"
                    />
                    <div>
                      <p className="text-sm font-medium">{comment.profiles?.full_name || "Unknown"}</p>
                      <p className="text-xs text-slate-500">
                        {comment.profiles?.username ? `@${comment.profiles.username}` : comment.user_id}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 break-all">Comment ID: {comment.id}</p>
                  <p className="whitespace-pre-wrap text-sm">{comment.content}</p>
                  <p className="text-xs text-slate-500">{formatDate(comment.created_at)}</p>
                  <div className="flex flex-wrap gap-2">
                    {comment.user_id ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/users?search=${comment.user_id}`}>Comment author</Link>
                      </Button>
                    ) : null}
                    {hasPermission("comments:delete") && comment.id ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void deleteComment(comment.id!)}
                      >
                        Delete comment
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {target?.kind === "user" && target.user ? (
                <p className="text-sm">
                  This report targets user{" "}
                  <Link className="text-blue-600 hover:underline" href={`/users?search=${target.user.id}`}>
                    @{target.user.username || target.user.id}
                  </Link>
                  .
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <ProfileCard title="Reporter" profile={report.reporter} fallbackId={report.reporter_user_id} />
          <ProfileCard title="Reported User" profile={report.reportedUser} fallbackId={reportedUserId} />

          {reportedUserId && hasPermission("users:suspend") ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">User moderation</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {report.reportedUser?.status === "suspended" ? (
                  <Button size="sm" disabled={busy} onClick={() => void activateUser(reportedUserId)}>
                    Reactivate account
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void suspendUser(reportedUserId)}
                  >
                    Suspend account
                  </Button>
                )}
                <p className="w-full text-xs text-slate-500">
                  Account actions require confirmation and do not change the report status automatically.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit trail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!report.audit?.length ? (
                <p className="text-sm text-slate-500">No related audit entries yet.</p>
              ) : (
                report.audit.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800">
                    <p className="font-semibold">{entry.action}</p>
                    <p>{entry.actor_name || entry.actor_id || "system"}</p>
                    <p className="text-slate-500">{formatDate(entry.created_at)}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
