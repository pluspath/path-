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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Friendship = {
  id: string;
  status?: string | null;
  requester_id?: string;
  receiver_id?: string;
  created_at?: string;
  requester?: { username?: string; full_name?: string | null } | null;
  receiver?: { username?: string; full_name?: string | null } | null;
};

function statusVariant(status?: string | null): "success" | "warning" | "danger" | "muted" {
  if (status === "accepted") return "success";
  if (status === "pending") return "warning";
  if (status === "blocked" || status === "declined") return "danger";
  return "muted";
}

export default function FriendshipsPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<Friendship[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const res = await api.get<Paginated<Friendship>>(`/friendships?${params}`);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load friendships");
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

  const name = (u?: { username?: string; full_name?: string | null } | null, id?: string) =>
    u?.full_name || (u?.username ? `@${u.username}` : id?.slice(0, 8) || "—");

  const columns: Column<Friendship>[] = [
    {
      key: "pair",
      header: "Connection",
      cell: (f) => (
        <div>
          <p className="font-medium">
            {name(f.requester, f.requester_id)} → {name(f.receiver, f.receiver_id)}
          </p>
          <p className="text-xs text-zinc-500">{f.id}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (f) => <Badge variant={statusVariant(f.status)}>{f.status || "—"}</Badge>,
    },
    {
      key: "created",
      header: "Created",
      cell: (f) => formatDate(f.created_at),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (f) =>
        hasPermission("friendships:write") ? (
          <div className="flex flex-wrap gap-1">
            {f.status === "pending" && (
              <Button
                size="sm"
                onClick={() => void act(() => api.post(`/friendships/${f.id}/confirm`), "Confirmed")}
              >
                Confirm
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (!confirm("Cancel this friendship?")) return;
                void act(() => api.post(`/friendships/${f.id}/cancel`), "Cancelled");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          "—"
        ),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        title="Friendships"
        description="Review and manage friend connections"
        actions={
          hasPermission("friendships:read") ? (
            <Button
              variant="outline"
              onClick={() =>
                void api
                  .download("/friendships/export", "friendships.csv")
                  .then(() => toast.success("Export started"))
                  .catch((e) => toast.error(e.message))
              }
            >
              Export CSV
            </Button>
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
              placeholder="Username or ID…"
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
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
              <option value="blocked">Blocked</option>
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
          <DataTable columns={columns} rows={rows} rowKey={(f) => f.id} />
          <PaginationBar
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
