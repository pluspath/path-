"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type CmsItem = {
  slug: string;
  title?: string | null;
  body?: string | null;
  is_published?: boolean;
  updated_at?: string;
  created_at?: string;
};

export default function CmsPage() {
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<CmsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", body: "", is_published: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: CmsItem[] }>("/cms");
      setItems(res.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load CMS content");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openEdit(slug: string) {
    setBusy(true);
    try {
      const res = await api.get<{ data: CmsItem }>(`/cms/${slug}`);
      setSelectedSlug(slug);
      setForm({
        title: res.data.title || "",
        body: res.data.body || "",
        is_published: !!res.data.is_published,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load content");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!selectedSlug) return;
    setBusy(true);
    try {
      await api.put(`/cms/${selectedSlug}`, {
        title: form.title,
        body: form.body,
        is_published: form.is_published,
      });
      toast.success("Content saved");
      setSelectedSlug(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !items.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Content"
        title="CMS"
        description="Edit published pages and legal content. Public site: site.pathplus.store (Privacy, Terms, Support)."
      />

      {loading ? (
        <LoadingState />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Card key={item.slug} className="transition hover:-translate-y-0.5 hover:shadow-md">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle>{item.title || item.slug}</CardTitle>
                    <CardDescription className="mt-1 font-mono text-xs">{item.slug}</CardDescription>
                  </div>
                  <Badge variant={item.is_published ? "success" : "muted"}>
                    {item.is_published ? "published" : "draft"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="line-clamp-3 text-sm text-slate-500">{item.body || "No body yet."}</p>
                <p className="text-xs text-slate-400">Updated {formatDate(item.updated_at || item.created_at)}</p>
                {(item.slug === "privacy" || item.slug === "terms") && item.is_published ? (
                  <p className="break-all text-xs text-slate-500">
                    Public URL:{" "}
                    <a
                      className="font-medium text-blue-600 underline"
                      href={`https://site.pathplus.store/${item.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      https://site.pathplus.store/{item.slug}
                    </a>
                  </p>
                ) : null}
                {hasPermission("cms:write") && (
                  <Button size="sm" variant="outline" onClick={() => void openEdit(item.slug)}>
                    Edit
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {items.length === 0 && (
            <Card className="md:col-span-2 xl:col-span-3">
              <CardContent className="py-10 text-center text-sm text-slate-500">
                No CMS content found.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {selectedSlug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedSlug(null)}>
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>Edit · {selectedSlug}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Body</Label>
                <Textarea
                  className="min-h-[240px]"
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_published}
                  onChange={(e) => setForm((f) => ({ ...f, is_published: e.target.checked }))}
                />
                Published
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedSlug(null)}>
                  Cancel
                </Button>
                <Button disabled={busy} onClick={() => void save()}>
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
