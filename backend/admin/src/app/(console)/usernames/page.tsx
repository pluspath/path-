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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type UsernameRow = {
  id: string;
  username?: string | null;
  full_name?: string | null;
  status?: string | null;
  created_at?: string;
  suspended_reason?: string | null;
};

type PendingRow = {
  id: string;
  email: string;
  username: string;
  full_name?: string | null;
  created_at?: string;
  expires_at?: string;
};

export default function UsernamesPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<UsernameRow[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [releaseInput, setReleaseInput] = useState("");
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      const res = await api.get<Paginated<UsernameRow> & { pendingRegistrations?: PendingRow[] }>(
        `/usernames?${params}`
      );
      setRows(res.data);
      setMeta(res.meta);
      setPending(res.pendingRegistrations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load usernames");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function releaseUsername(username: string) {
    if (!username.trim()) return;
    if (!confirm(`Release @${username.trim()} so a new account can use it?`)) return;
    setBusy(true);
    try {
      await api.post("/usernames/release", { username: username.trim() });
      toast.success(`Released @${username.trim()}`);
      setReleaseInput("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Release failed");
    } finally {
      setBusy(false);
    }
  }

  async function renameUser(userId: string) {
    const next = (renameDrafts[userId] || "").trim().toLowerCase();
    if (!next) {
      toast.error("Enter a new username");
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/usernames/${userId}`, { username: next });
      toast.success(`Renamed to @${next}`);
      setRenameDrafts((d) => {
        const copy = { ...d };
        delete copy[userId];
        return copy;
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearPending(id: string) {
    if (!confirm("Clear this pending signup and free its username?")) return;
    setBusy(true);
    try {
      await api.delete(`/usernames/pending/${id}`);
      toast.success("Pending signup cleared");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<UsernameRow>[] = [
    {
      key: "username",
      header: "Username",
      cell: (r) => (
        <div>
          <p className="font-medium">@{r.username || "—"}</p>
          <p className="text-xs text-slate-500">{r.full_name || "—"}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Badge variant={r.status === "suspended" ? "danger" : "muted"}>{r.status || "active"}</Badge>
      ),
    },
    {
      key: "created",
      header: "Joined",
      cell: (r) => <span className="text-sm text-slate-500">{formatDate(r.created_at)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (r) =>
        hasPermission("users:write") ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-36"
              placeholder="new username"
              value={renameDrafts[r.id] ?? ""}
              onChange={(e) => setRenameDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void renameUser(r.id)}>
              Rename
            </Button>
            {r.username ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void releaseUsername(r.username!)}>
                Release
              </Button>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  const pendingColumns: Column<PendingRow>[] = [
    {
      key: "username",
      header: "Username",
      cell: (r) => <span className="font-medium">@{r.username}</span>,
    },
    {
      key: "email",
      header: "Email",
      cell: (r) => <span className="text-sm">{r.email}</span>,
    },
    {
      key: "expires",
      header: "Expires",
      cell: (r) => <span className="text-sm text-slate-500">{formatDate(r.expires_at)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (r) =>
        hasPermission("users:write") ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void clearPending(r.id)}>
            Clear
          </Button>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usernames"
        description="Search, rename, or release usernames so deleted accounts can be reclaimed."
      />

      {hasPermission("users:write") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Release a username</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              placeholder="username to free"
              value={releaseInput}
              onChange={(e) => setReleaseInput(e.target.value)}
            />
            <Button disabled={busy || !releaseInput.trim()} onClick={() => void releaseUsername(releaseInput)}>
              Release
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2">
        <Input
          className="max-w-sm"
          placeholder="Search username or name…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <Button variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
          <PaginationBar
            page={page}
            totalPages={meta.totalPages}
            total={meta.total}
            onPageChange={setPage}
          />
        </>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Pending signups holding usernames</h2>
        <p className="text-sm text-slate-500">
          Incomplete registrations reserve a username until they expire or are cleared.
        </p>
        {pending.length === 0 ? (
          <p className="text-sm text-slate-400">No pending registrations.</p>
        ) : (
          <DataTable columns={pendingColumns} rows={pending} rowKey={(r) => r.id} />
        )}
      </div>
    </div>
  );
}
