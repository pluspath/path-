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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type Notification = {
  id: string;
  title?: string | null;
  message?: string | null;
  body?: string | null;
  type?: string | null;
  user_id?: string | null;
  created_at?: string;
  read?: boolean;
};

export default function NotificationsPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<Notification[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    message: "",
    audience: "all" as "all" | "selected" | "group",
    userIds: "",
    group: "active" as "active" | "suspended",
    sendPush: true,
    sendInApp: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Paginated<Notification>>(
        `/notifications?page=${page}&limit=20`
      );
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    if (!form.title.trim() || !form.message.trim()) {
      toast.error("Title and message are required");
      return;
    }
    setBusy(true);
    try {
      const userIds =
        form.audience === "selected"
          ? form.userIds
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      await api.post("/notifications/send", {
        title: form.title.trim(),
        message: form.message.trim(),
        audience: form.audience,
        userIds,
        group: form.audience === "group" ? form.group : undefined,
        sendPush: form.sendPush,
        sendInApp: form.sendInApp,
      });
      toast.success("Notification sent");
      setForm((f) => ({ ...f, title: "", message: "", userIds: "" }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Notification>[] = [
    {
      key: "title",
      header: "Notification",
      cell: (n) => (
        <div className="max-w-lg">
          <p className="font-medium">{n.title || n.type || "Notification"}</p>
          <p className="line-clamp-2 text-sm text-slate-500">{n.message || n.body || "â€”"}</p>
        </div>
      ),
    },
    {
      key: "user",
      header: "User",
      cell: (n) => <span className="text-xs text-slate-500">{n.user_id?.slice(0, 8) || "broadcast"}</span>,
    },
    {
      key: "read",
      header: "Read",
      cell: (n) => (
        <Badge variant={n.read ? "muted" : "success"}>{n.read ? "read" : "unread"}</Badge>
      ),
    },
    {
      key: "created",
      header: "Sent",
      cell: (n) => formatDate(n.created_at),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader eyebrow="Community" title="Notifications" description="Broadcast and review recent notifications" />

      {hasPermission("notifications:send") && (
        <Card>
          <CardHeader>
            <CardTitle>Broadcast</CardTitle>
            <CardDescription>Send push and/or in-app messages to users</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Message</Label>
              <Textarea
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                maxLength={1000}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Audience</Label>
              <select
                className="atlas-select"
                value={form.audience}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    audience: e.target.value as "all" | "selected" | "group",
                  }))
                }
              >
                <option value="all">All users</option>
                <option value="selected">Selected users</option>
                <option value="group">Group</option>
              </select>
            </div>
            {form.audience === "group" && (
              <div className="space-y-1.5">
                <Label>Group</Label>
                <select
                  className="atlas-select"
                  value={form.group}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, group: e.target.value as "active" | "suspended" }))
                  }
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            )}
            {form.audience === "selected" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label>User IDs</Label>
                <Textarea
                  value={form.userIds}
                  onChange={(e) => setForm((f) => ({ ...f, userIds: e.target.value }))}
                  placeholder="One UUID per line or comma-separated"
                />
              </div>
            )}
            <div className="flex items-center gap-6 md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.sendPush}
                  onChange={(e) => setForm((f) => ({ ...f, sendPush: e.target.checked }))}
                />
                Send push
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.sendInApp}
                  onChange={(e) => setForm((f) => ({ ...f, sendInApp: e.target.checked }))}
                />
                Send in-app
              </label>
            </div>
            <div className="md:col-span-2">
              <Button disabled={busy} onClick={() => void send()}>
                Send notification
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(n) => n.id} empty="No notifications yet." />
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
