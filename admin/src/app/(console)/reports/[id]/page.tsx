"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
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
    post?: {
      id?: string;
      content?: string | null;
      media?: { url: string; type: string }[];
    };
    comment?: {
      id?: string;
      content?: string | null;
      created_at?: string | null;
    };
    parentPost?: {
      id?: string;
      content?: string | null;
      media?: { url: string; type: string }[];
    };
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
          <div>
            <p className="font-semibold">{profile?.full_name || "Unknown"}</p>
            <p className="text-sm text-slate-500">
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
      toast.success("Reported post hidden");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Hide failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteComment(commentId: string) {
    if (!hasPermission("comments:delete") || busy) return;
    if (!confirm("Delete only this reported comment?")) return;
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

  if (loading) return <LoadingState />;
  if (error || !report) return <ErrorState message={error || "Report not found"} />;

  const target = report.target;
  const post = target?.post || target?.parentPost;
  const comment = target?.comment;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Community"
        title="Report details"
        description="Full incident context for moderation"
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

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
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
                    Changing report status does not automatically delete or hide the reported content.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reported content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!target?.available ? (
                <p className="text-sm text-slate-500">{target?.message || "Target unavailable."}</p>
              ) : null}

              {post ? (
                <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Post {post.id}</p>
                    <Link href={`/posts/${post.id}`} className="text-sm text-blue-600 hover:underline">
                      Open post
                    </Link>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{post.content || "(no text)"}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(post.media || []).map((m, idx) =>
                      m.type === "video" ? (
                        <video key={idx} src={m.url} controls className="max-h-56 w-full rounded-lg bg-black" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={idx} src={m.url} alt="" className="max-h-56 w-full rounded-lg object-cover" />
                      )
                    )}
                  </div>
                  {hasPermission("posts:write") ? (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void hidePost(post.id)}>
                      Hide reported post
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {comment ? (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                  <p className="text-sm font-semibold">Reported comment</p>
                  <p className="text-xs text-slate-500 break-all">{comment.id}</p>
                  <p className="whitespace-pre-wrap text-sm">{comment.content}</p>
                  <p className="text-xs text-slate-500">{formatDate(comment.created_at)}</p>
                  {hasPermission("comments:delete") ? (
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => void deleteComment(comment.id)}>
                      Delete comment
                    </Button>
                  ) : null}
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
          <ProfileCard
            title="Reporter"
            profile={report.reporter}
            fallbackId={report.reporter_user_id}
          />
          <ProfileCard
            title="Reported user"
            profile={report.reportedUser}
            fallbackId={report.reported_user_id}
          />
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
