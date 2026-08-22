"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Paginated } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { DataTable, ErrorState, LoadingState, PaginationBar, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type AdminLog = {
  id: string;
  category?: string | null;
  action?: string | null;
  actor_type?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at?: string;
};

const CATEGORIES = [
  "admin_login",
  "admin_login_failed",
  "admin_activity",
  "user_activity",
  "api_error",
  "unhandled_exception",
  "system",
] as const;

function categoryVariant(
  category?: string | null
): "success" | "warning" | "danger" | "muted" | "default" {
  if (category === "admin_login" || category === "admin_activity") return "success";
  if (category === "admin_login_failed" || category === "api_error") return "warning";
  if (category === "unhandled_exception") return "danger";
  if (category === "system" || category === "user_activity") return "muted";
  return "default";
}

export default function LogsPage() {
  const [rows, setRows] = useState<AdminLog[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (category) params.set("category", category);
      const res = await api.get<Paginated<AdminLog>>(`/logs?${params}`);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [page, search, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<AdminLog>[] = [
    {
      key: "action",
      header: "Event",
      cell: (r) => (
        <div className="max-w-md">
          <p className="font-medium">{r.action || "—"}</p>
          {(r.target_type || r.target_id) && (
            <p className="mt-0.5 text-xs text-slate-400">
              {r.target_type}
              {r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ""}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (r) => (
        <Badge variant={categoryVariant(r.category)}>{r.category || "—"}</Badge>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      cell: (r) => (
        <div className="text-sm">
          <p>{r.actor_name || r.actor_type || "system"}</p>
          {r.ip_address ? (
            <p className="text-xs text-slate-400">{r.ip_address}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "created",
      header: "When",
      cell: (r) => formatDate(r.created_at),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Operations"
        title="Logs"
        description="Admin activity, auth events, and system audit trail"
        actions={
          <Button variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Action, actor name…"
              onKeyDown={(e) => {
                if (e.key === "Enter") setPage(1);
              }}
            />
          </div>
          <div className="w-full space-y-1.5 md:w-56">
            <Label>Category</Label>
            <select
              className="atlas-select"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
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
    </div>
  );
}
