"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type Paginated } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { DataTable, ErrorState, LoadingState, PaginationBar, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type DeletionRequest = {
  id: string;
  user_id: string;
  reason?: string | null;
  status?: string | null;
  created_at?: string;
  profiles?: {
    id: string;
    username?: string | null;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

export default function DeletionRequestsPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<DeletionRequest[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20", status });
      const res = await api.get<Paginated<DeletionRequest>>(`/deletion-requests?${params}`);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deletion requests");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    if (!confirm("Approve and permanently delete this account?")) return;
    try {
      await api.post(`/deletion-requests/${id}/approve`, {});
      toast.success("Account deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    }
  }

  async function reject(id: string) {
    try {
      await api.post(`/deletion-requests/${id}/reject`, { note: "Rejected by admin" });
      toast.success("Request rejected");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    }
  }

  const columns: Column<DeletionRequest>[] = [
    {
      key: "user",
      header: "User",
      cell: (r) => (
        <div>
          <p className="font-medium">{r.profiles?.full_name || r.profiles?.username || r.user_id}</p>
          <p className="text-xs text-slate-500">@{r.profiles?.username || "—"}</p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (r) => <p className="max-w-sm text-sm text-slate-600">{r.reason || "—"}</p>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <Badge variant={r.status === "pending" ? "danger" : "muted"}>{r.status}</Badge>,
    },
    {
      key: "created",
      header: "Requested",
      cell: (r) => <span className="text-sm text-slate-500">{formatDate(r.created_at)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (r) =>
        r.status === "pending" && hasPermission("users:delete") ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void approve(r.id)}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => void reject(r.id)}>
              Reject
            </Button>
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account deletions"
        description="Users who requested account deletion. Approve to permanently remove the account."
      />

      <div className="flex gap-2">
        {["pending", "done", "rejected", "all"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => {
              setPage(1);
              setStatus(s);
            }}
          >
            {s}
          </Button>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
          <PaginationBar page={meta.page} totalPages={meta.totalPages} total={meta.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
