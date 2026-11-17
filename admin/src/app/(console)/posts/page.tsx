"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

type Post = {
  id: string;
  user_id?: string;
  type?: string;
  content?: string | null;
  image_url?: string | null;
  location?: string | null;
  is_hidden?: boolean;
  is_published?: boolean;
  created_at?: string;
  mediaCount?: number;
  mediaKind?: string;
  media?: { url: string; type: string }[];
  profiles?: {
    username?: string;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
};

const emptyForm = {
  user_id: "",
  type: "moment",
  content: "",
  image_url: "",
  location: "",
};

export default function PostsPage() {
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<Post[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [hidden, setHidden] = useState("");
  const [published, setPublished] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      if (type) params.set("type", type);
      if (hidden) params.set("hidden", hidden);
      if (published) params.set("published", published);
      const res = await api.get<Paginated<Post>>(`/posts?${params}`);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, [page, search, type, hidden, published]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(post: Post) {
    setEditing(post);
    setForm({
      user_id: post.user_id || "",
      type: post.type || "moment",
      content: post.content || "",
      image_url: post.image_url || "",
      location: post.location || "",
    });
    setFormOpen(true);
  }

  async function saveForm() {
    setBusy(true);
    try {
      const payload = {
        user_id: form.user_id,
        type: form.type,
        content: form.content || undefined,
        image_url: form.image_url || undefined,
        location: form.location || undefined,
      };
      if (editing) {
        await api.patch(`/posts/${editing.id}`, {
          type: payload.type,
          content: payload.content,
          image_url: payload.image_url,
          location: payload.location,
        });
        toast.success("Post updated");
      } else {
        await api.post("/posts", payload);
        toast.success("Post created");
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, success: string) {
    try {
      await api.post(path);
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  }

  const columns: Column<Post>[] = [
    {
      key: "content",
      header: "Post",
      cell: (p) => (
        <div className="flex max-w-lg items-start gap-3">
          {p.media?.[0]?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.media[0].url} alt="" className="h-12 w-12 rounded-lg object-cover bg-slate-200" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-500">
              {(p.mediaKind || "text").toUpperCase()}
            </div>
          )}
          <div>
            <p className="line-clamp-2 font-medium">{p.content || "(no content)"}</p>
            <div className="mt-1 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.profiles?.avatar_url || "/favicon.ico"}
                alt=""
                className="h-5 w-5 rounded-full object-cover bg-slate-200"
              />
              <p className="text-xs text-slate-500">
                {p.profiles?.full_name || "Unknown"} ·{" "}
                {p.profiles?.username ? `@${p.profiles.username}` : p.user_id?.slice(0, 8)} · {p.type}
              </p>
            </div>
            <p className="mt-1 break-all text-[11px] text-slate-400">{p.id}</p>
          </div>
        </div>
      ),
    },
    {
      key: "flags",
      header: "Status",
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant={p.is_published === false ? "muted" : "success"}>
            {p.is_published === false ? "unpublished" : "published"}
          </Badge>
          {p.is_hidden ? <Badge variant="warning">hidden</Badge> : null}
          <Badge variant="muted">{p.mediaKind || "text"}</Badge>
        </div>
      ),
    },
    {
      key: "media",
      header: "Media",
      cell: (p) => String(p.mediaCount ?? p.media?.length ?? 0),
    },
    {
      key: "location",
      header: "Location",
      cell: (p) => p.location || "—",
    },
    {
      key: "created",
      header: "Created",
      cell: (p) => formatDate(p.created_at),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (p) => (
        <div className="flex min-w-[9.5rem] flex-col gap-1">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/posts/${p.id}`}>View details</Link>
          </Button>
          {hasPermission("posts:write") ? (
            !p.is_hidden ? (
              <Button size="sm" variant="secondary" onClick={() => void act(`/posts/${p.id}/hide`, "Hidden")}>
                Disable
              </Button>
            ) : (
              <Button size="sm" onClick={() => void act(`/posts/${p.id}/unhide`, "Restored")}>
                Restore
              </Button>
            )
          ) : null}
          {hasPermission("posts:delete") ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (!confirm(`Permanently delete post ${p.id}?`)) return;
                void api
                  .delete(`/posts/${p.id}`)
                  .then(() => {
                    toast.success("Deleted");
                    return load();
                  })
                  .catch((e) => toast.error(e.message));
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Community" title="Posts"
        description="Moderate moments and content across Path+"
        actions={
          hasPermission("posts:write") ? (
            <Button onClick={openCreate}>Create post</Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-5">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Content, location, username, post ID..."
              onKeyDown={(e) => e.key === "Enter" && setPage(1)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="moment" />
          </div>
          <div className="space-y-1.5">
            <Label>Hidden</Label>
            <select
              className="atlas-select"
              value={hidden}
              onChange={(e) => {
                setHidden(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Any</option>
              <option value="true">Hidden</option>
              <option value="false">Visible</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Published</Label>
            <select
              className="atlas-select"
              value={published}
              onChange={(e) => {
                setPublished(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Any</option>
              <option value="true">Published</option>
              <option value="false">Unpublished</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} />
          <PaginationBar
            page={meta.page}
            totalPages={meta.totalPages}
            total={meta.total}
            onPageChange={setPage}
          />
        </>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{editing ? "Edit post" : "Create post"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!editing && (
                <div className="space-y-1.5">
                  <Label>User ID</Label>
                  <Input
                    value={form.user_id}
                    onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
                    placeholder="UUID"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Input value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Content</Label>
                <Textarea
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Image URL</Label>
                <Input
                  value={form.image_url}
                  onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setFormOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={busy || (!editing && !form.user_id)} onClick={() => void saveForm()}>
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
