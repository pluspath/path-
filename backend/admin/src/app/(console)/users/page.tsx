"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api, type Paginated } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { DataTable, ErrorState, LoadingState, PaginationBar, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type UserRow = {
  id: string;
  username?: string;
  full_name?: string | null;
  email?: string | null;
  status?: string | null;
  location?: string | null;
  created_at?: string;
  postCount?: number;
  friendCount?: number;
};

type UserDetail = {
  profile: UserRow & Record<string, unknown>;
  email: string | null;
  emailConfirmed: boolean;
  banned: boolean;
  postCount: number;
  friendCount: number;
  recentPosts: { id: string; type?: string; content?: string; created_at?: string; is_hidden?: boolean }[];
};

function UsersPageInner() {
  const { hasPermission } = useAuth();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const res = await api.get<Paginated<UserRow>>(`/users?${params}`);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(id: string) {
    setDetailLoading(true);
    try {
      const res = await api.get<{ data: UserDetail }>(`/users/${id}`);
      setSelected(res.data);
      setSuspendReason("");
      setNewPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load user");
    } finally {
      setDetailLoading(false);
    }
  }

  async function runAction(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      await load();
      if (selected) await openDetail(selected.profile.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: "user",
      header: "User",
      cell: (u) => (
        <div>
          <p className="font-medium">{u.full_name || u.username || "—"}</p>
          <p className="text-xs text-zinc-500">@{u.username}</p>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      cell: (u) => <span className="text-zinc-600 dark:text-zinc-300">{u.email || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (u) => (
        <Badge variant={u.status === "suspended" ? "danger" : "success"}>{u.status || "active"}</Badge>
      ),
    },
    {
      key: "stats",
      header: "Stats",
      cell: (u) => (
        <span className="text-xs text-zinc-500">
          {formatNumber(u.postCount ?? 0)} posts · {formatNumber(u.friendCount ?? 0)} friends
        </span>
      ),
    },
    {
      key: "created",
      header: "Joined",
      cell: (u) => formatDate(u.created_at),
    },
    {
      key: "actions",
      header: "",
      cell: (u) => (
        <Button size="sm" variant="outline" onClick={() => void openDetail(u.id)}>
          View
        </Button>
      ),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        title="Users"
        description="Search, moderate, and manage Path+ accounts"
        actions={
          hasPermission("users:read") ? (
            <Button
              variant="outline"
              onClick={() => {
                const params = new URLSearchParams();
                if (search.trim()) params.set("search", search.trim());
                if (status) params.set("status", status);
                const qs = params.toString();
                void api
                  .download(`/users/export${qs ? `?${qs}` : ""}`, "users.csv")
                  .then(() => toast.success("Export started"))
                  .catch((e) => toast.error(e.message));
              }}
            >
              Export CSV
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="user-search">Search</Label>
            <Input
              id="user-search"
              placeholder="Name, username, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setPage(1);
              }}
            />
          </div>
          <div className="w-full space-y-1.5 md:w-48">
            <Label htmlFor="user-status">Status</Label>
            <select
              id="user-status"
              className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
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
          <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} />
          <PaginationBar
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            onPageChange={setPage}
            disabled={loading}
          />
        </>
      )}

      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 p-0 sm:p-4" onClick={() => setSelected(null)}>
          <div
            className="h-full w-full max-w-lg overflow-y-auto rounded-none border bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading || !selected ? (
              <LoadingState />
            ) : (
              <div className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {selected.profile.full_name || selected.profile.username}
                    </h2>
                    <p className="text-sm text-zinc-500">@{selected.profile.username}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Close
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant={selected.profile.status === "suspended" ? "danger" : "success"}>
                    {String(selected.profile.status || "active")}
                  </Badge>
                  <Badge variant={selected.emailConfirmed ? "success" : "warning"}>
                    {selected.emailConfirmed ? "Email verified" : "Email unverified"}
                  </Badge>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p>
                      <span className="text-zinc-500">Email:</span> {selected.email || "—"}
                    </p>
                    <p>
                      <span className="text-zinc-500">Location:</span> {selected.profile.location || "—"}
                    </p>
                    <p>
                      <span className="text-zinc-500">Posts:</span> {formatNumber(selected.postCount)}
                    </p>
                    <p>
                      <span className="text-zinc-500">Friends:</span> {formatNumber(selected.friendCount)}
                    </p>
                    <p>
                      <span className="text-zinc-500">Joined:</span> {formatDate(selected.profile.created_at)}
                    </p>
                    <p className="break-all text-xs text-zinc-400">ID: {selected.profile.id}</p>
                  </CardContent>
                </Card>

                {selected.recentPosts?.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Recent posts</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {selected.recentPosts.map((p) => (
                        <div key={p.id} className="rounded-xl border px-3 py-2 text-sm">
                          <p className="line-clamp-2">{p.content || p.type || "—"}</p>
                          <p className="text-xs text-zinc-500">{formatDate(p.created_at)}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-3 border-t pt-4">
                  {hasPermission("users:suspend") && selected.profile.status !== "suspended" && (
                    <div className="space-y-2">
                      <Label>Suspend reason</Label>
                      <Textarea
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        placeholder="Optional reason"
                      />
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void runAction(
                            () =>
                              api.post(`/users/${selected.profile.id}/suspend`, {
                                reason: suspendReason || undefined,
                              }),
                            "User suspended"
                          )
                        }
                      >
                        Suspend
                      </Button>
                    </div>
                  )}

                  {hasPermission("users:suspend") && selected.profile.status === "suspended" && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void runAction(
                          () => api.post(`/users/${selected.profile.id}/activate`),
                          "User activated"
                        )
                      }
                    >
                      Activate
                    </Button>
                  )}

                  {hasPermission("users:write") && (
                    <>
                      <div className="space-y-2">
                        <Label>Reset password</Label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min 8 characters"
                        />
                        <Button
                          variant="secondary"
                          disabled={busy || newPassword.length < 8}
                          onClick={() =>
                            void runAction(
                              () =>
                                api.post(`/users/${selected.profile.id}/reset-password`, {
                                  password: newPassword,
                                }),
                              "Password reset"
                            )
                          }
                        >
                          Reset password
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        disabled={busy || selected.emailConfirmed}
                        onClick={() =>
                          void runAction(
                            () => api.post(`/users/${selected.profile.id}/verify-email`),
                            "Email verified"
                          )
                        }
                      >
                        Verify email
                      </Button>
                    </>
                  )}

                  {hasPermission("users:delete") && (
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm("Delete this user permanently?")) return;
                        void runAction(
                          () => api.delete(`/users/${selected.profile.id}`),
                          "User deleted"
                        ).then(() => setSelected(null));
                      }}
                    >
                      Delete user
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <UsersPageInner />
    </Suspense>
  );
}
