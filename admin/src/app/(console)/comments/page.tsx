"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type Paginated } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { DataTable, ErrorState, LoadingState, PaginationBar, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Comment = {
  id: string;
  content?: string | null;
  moderation_status?: string | null;
  admin_reply?: string | null;
  post_id?: string;
  user_id?: string;
  created_at?: string;
  profiles?: { username?: string; full_name?: string | null } | null;
};

function statusVariant(status?: string | null): "success" | "danger" | "warning" | "muted" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "pending") return "warning";
  return "muted";
}

export default function CommentsPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<Comment[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyFor, setReplyFor] = useState<Comment | null>(null);
  const [replyText, setReplyText] = useState("");
  const [reportFor, setReportFor] = useState<Comment | null>(null);
  const [reportReason, setReportReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const res = await api.get<Paginated<Comment>>(`/comments?${params}`);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, success: string) {
    try {
      await fn();
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  const columns: Column<Comment>[] = [
    {
      key: "content",
      header: "Comment",
      cell: (c) => (
        <div className="max-w-md">
          <p className="line-clamp-3">{c.content || "—"}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {c.profiles?.username ? `@${c.profiles.username}` : c.user_id?.slice(0, 8)}
            {c.admin_reply ? ` · reply: ${c.admin_reply}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (c) => <Badge variant={statusVariant(c.moderation_status)}>{c.moderation_status || "—"}</Badge>,
    },
    {
      key: "created",
      header: "Created",
      cell: (c) => formatDate(c.created_at),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (c) => (
        <div className="flex flex-wrap gap-1">
          {hasPermission("comments:write") && (
            <>
              <Button
                size="sm"
                onClick={() => void act(() => api.post(`/comments/${c.id}/approve`), "Approved")}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void act(() => api.post(`/comments/${c.id}/reject`), "Rejected")}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReplyFor(c);
                  setReplyText(c.admin_reply || "");
                }}
              >
                Reply
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReportFor(c);
                  setReportReason("");
                }}
              >
                Report
              </Button>
            </>
          )}
          {hasPermission("comments:delete") && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (!confirm("Delete this comment?")) return;
                void act(() => api.delete(`/comments/${c.id}`), "Deleted");
              }}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Comments" description="Moderate user comments and replies" />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Comment text…"
              onKeyDown={(e) => e.key === "Enter" && setPage(1)}
            />
          </div>
          <div className="w-full space-y-1.5 md:w-48">
            <Label>Status</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <Button
            onClick={() => {
              setPage(1);
              void load();
            }}
          >
            Apply
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} />
          <PaginationBar
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            onPageChange={setPage}
          />
        </>
      )}

      {replyFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReplyFor(null)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardContent className="space-y-3 pt-5">
              <h3 className="font-semibold">Reply to comment</h3>
              <Textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReplyFor(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={!replyText.trim()}
                  onClick={() =>
                    void act(
                      () => api.post(`/comments/${replyFor.id}/reply`, { reply: replyText.trim() }),
                      "Reply saved"
                    ).then(() => setReplyFor(null))
                  }
                >
                  Send reply
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {reportFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReportFor(null)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardContent className="space-y-3 pt-5">
              <h3 className="font-semibold">Report abuse</h3>
              <Textarea
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                placeholder="Reason"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReportFor(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={!reportReason.trim()}
                  onClick={() =>
                    void act(
                      () =>
                        api.post(`/comments/${reportFor.id}/report`, {
                          reason: reportReason.trim(),
                        }),
                      "Reported"
                    ).then(() => setReportFor(null))
                  }
                >
                  Report
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
