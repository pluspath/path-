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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Report = {
  id: string;
  status?: string | null;
  target_type?: string;
  target_id?: string;
  reason?: string | null;
  details?: string | null;
  resolution_note?: string | null;
  reporter_user_id?: string | null;
  created_at?: string;
};

const emptyCreate = {
  reporter_user_id: "",
  target_type: "post" as "post" | "comment" | "user" | "message" | "other",
  target_id: "",
  reason: "",
  details: "",
};

function statusVariant(status?: string | null): "success" | "warning" | "danger" | "muted" {
  if (status === "resolved") return "success";
  if (status === "reviewing") return "warning";
  if (status === "open") return "danger";
  return "muted";
}

export default function ReportsPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<Report[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editNote, setEditNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const res = await api.get<Paginated<Report>>(`/reports?${params}`);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(id: string, next: string) {
    try {
      await api.patch(`/reports/${id}`, {
        status: next,
        resolution_note: editNote[id] || undefined,
      });
      toast.success("Report updated");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function createReport() {
    try {
      await api.post("/reports", {
        reporter_user_id: createForm.reporter_user_id || undefined,
        target_type: createForm.target_type,
        target_id: createForm.target_id,
        reason: createForm.reason,
        details: createForm.details || undefined,
      });
      toast.success("Report created");
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  }

  const columns: Column<Report>[] = [
    {
      key: "report",
      header: "Report",
      cell: (r) => (
        <div className="max-w-md">
          <p className="font-medium">
            {r.target_type} آ· {r.target_id}
          </p>
          <p className="line-clamp-2 text-sm text-slate-500">{r.reason}</p>
          {r.details ? <p className="mt-1 line-clamp-2 text-xs text-slate-400">{r.details}</p> : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge variant={statusVariant(r.status)}>{r.status || "open"}</Badge>,
    },
    {
      key: "created",
      header: "Created",
      cell: (r) => formatDate(r.created_at),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (r) =>
        hasPermission("reports:write") ? (
          <div className="space-y-2">
            <Input
              className="h-8"
              placeholder="Resolution note"
              value={editNote[r.id] || ""}
              onChange={(e) => setEditNote((m) => ({ ...m, [r.id]: e.target.value }))}
            />
            <div className="flex flex-wrap gap-1">
              {(["open", "reviewing", "resolved", "dismissed"] as const).map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => void updateStatus(r.id, s)}>
                  {s}
                </Button>
              ))}
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (!confirm("Delete this report?")) return;
                  void api
                    .delete(`/reports/${r.id}`)
                    .then(() => {
                      toast.success("Deleted");
                      return load();
                    })
                    .catch((e) => toast.error(e.message));
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          "â€”"
        ),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Community" title="Reports"
        description="Triage abuse reports and moderation queues"
        actions={
          hasPermission("reports:write") ? (
            <Button onClick={() => setCreateOpen(true)}>Create report</Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reason, targetâ€¦"
              onKeyDown={(e) => e.key === "Enter" && setPage(1)}
            />
          </div>
          <div className="w-full space-y-1.5 md:w-48">
            <Label>Status</Label>
            <select
              className="atlas-select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="reviewing">Reviewing</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
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
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
          <PaginationBar
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            onPageChange={setPage}
          />
        </>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateOpen(false)}>
          <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>Create report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Target type</Label>
                <select
                  className="atlas-select"
                  value={createForm.target_type}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      target_type: e.target.value as typeof f.target_type,
                    }))
                  }
                >
                  <option value="post">Post</option>
                  <option value="comment">Comment</option>
                  <option value="user">User</option>
                  <option value="message">Message</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Target ID</Label>
                <Input
                  value={createForm.target_id}
                  onChange={(e) => setCreateForm((f) => ({ ...f, target_id: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Reporter user ID (optional)</Label>
                <Input
                  value={createForm.reporter_user_id}
                  onChange={(e) => setCreateForm((f) => ({ ...f, reporter_user_id: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Input
                  value={createForm.reason}
                  onChange={(e) => setCreateForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Details</Label>
                <Textarea
                  value={createForm.details}
                  onChange={(e) => setCreateForm((f) => ({ ...f, details: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!createForm.target_id || !createForm.reason}
                  onClick={() => void createReport()}
                >
                  Create
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
