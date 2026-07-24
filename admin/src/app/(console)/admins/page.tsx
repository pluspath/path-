"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { DataTable, ErrorState, LoadingState, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AdminAccount = {
  id: string;
  username: string;
  role: string;
  display_name?: string | null;
  email?: string | null;
  is_active: boolean;
  created_at?: string;
  permissions?: string[];
};

const ROLES = ["super_admin", "admin", "moderator"] as const;

const emptyCreate = {
  username: "",
  password: "",
  role: "moderator" as (typeof ROLES)[number],
  display_name: "",
  email: "",
};

export default function AdminsPage() {
  const { hasPermission, user } = useAuth();
  const [rows, setRows] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyCreate);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: AdminAccount[] }>("/admins");
      setRows(res.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createAdmin() {
    setBusy(true);
    try {
      await api.post("/admins", {
        username: form.username,
        password: form.password,
        role: form.role,
        display_name: form.display_name || undefined,
        email: form.email || undefined,
      });
      toast.success("Admin created");
      setCreateOpen(false);
      setForm(emptyCreate);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchAdmin(id: string, patch: Partial<{ role: string; is_active: boolean }>) {
    try {
      await api.patch(`/admins/${id}`, patch);
      toast.success("Admin updated");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  const columns: Column<AdminAccount>[] = [
    {
      key: "user",
      header: "Admin",
      cell: (a) => (
        <div>
          <p className="font-medium">{a.display_name || a.username}</p>
          <p className="text-xs text-zinc-500">@{a.username}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (a) =>
        hasPermission("admins:write") ? (
          <select
            className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            value={a.role}
            onChange={(e) => void patchAdmin(a.id, { role: e.target.value })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <Badge>{a.role}</Badge>
        ),
    },
    {
      key: "active",
      header: "Active",
      cell: (a) => (
        <Badge variant={a.is_active ? "success" : "danger"}>{a.is_active ? "active" : "inactive"}</Badge>
      ),
    },
    {
      key: "created",
      header: "Created",
      cell: (a) => formatDate(a.created_at),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (a) =>
        hasPermission("admins:write") ? (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void patchAdmin(a.id, { is_active: !a.is_active })}
            >
              {a.is_active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={a.id === user?.id}
              onClick={() => {
                if (!confirm(`Delete admin @${a.username}?`)) return;
                void api
                  .delete(`/admins/${a.id}`)
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
        ) : (
          "—"
        ),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        title="Admin Accounts"
        description="Manage console operators and roles"
        actions={
          hasPermission("admins:write") ? (
            <Button onClick={() => setCreateOpen(true)}>Create admin</Button>
          ) : null
        }
      />

      {loading ? <LoadingState /> : <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} />}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateOpen(false)}>
          <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>Create admin</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min 10 chars, upper/lower/number/symbol"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <select
                  className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  value={form.role}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, role: e.target.value as (typeof ROLES)[number] }))
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Display name</Label>
                <Input
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={busy || !form.username || form.password.length < 10}
                  onClick={() => void createAdmin()}
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
