"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Card, CardContent } from "@/components/ui/card";

type FileItem = {
  name: string;
  id?: string | null;
  path: string;
  bucket: string;
  publicUrl?: string;
  isFolder?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { size?: number } | null;
};

export default function FilesPage() {
  const { hasPermission } = useAuth();
  const [buckets, setBuckets] = useState<string[]>(["Avatars", "Covers"]);
  const [bucket, setBucket] = useState("Avatars");
  const [path, setPath] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<FileItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBuckets = useCallback(async () => {
    try {
      const res = await api.get<{ data: string[] }>("/files/buckets");
      if (res.data?.length) {
        setBuckets(res.data);
        setBucket((b) => (res.data.includes(b) ? b : res.data[0]));
      }
    } catch {
      /* keep defaults */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ bucket, path });
      if (search.trim()) params.set("search", search.trim());
      const res = await api.get<{ data: FileItem[] }>(`/files?${params}`);
      setRows(res.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [bucket, path, search]);

  useEffect(() => {
    void loadBuckets();
  }, [loadBuckets]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteFile(item: FileItem) {
    if (!confirm(`Delete ${item.path}?`)) return;
    try {
      await api.delete("/files", { bucket: item.bucket, paths: [item.path] });
      toast.success("Deleted");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function replaceFile(file: File) {
    if (!replacing) return;
    try {
      const form = new FormData();
      form.set("bucket", replacing.bucket);
      form.set("path", replacing.path);
      form.set("file", file);
      await api.upload("/files/replace", form);
      toast.success("File replaced");
      setReplacing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replace failed");
    }
  }

  const columns: Column<FileItem>[] = [
    {
      key: "name",
      header: "Name",
      cell: (f) => (
        <div className="flex items-center gap-3">
          {!f.isFolder && f.publicUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.publicUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-xs dark:bg-zinc-800">
              {f.isFolder ? "DIR" : "FILE"}
            </div>
          )}
          <div>
            <p className="font-medium">{f.name}</p>
            <p className="text-xs text-zinc-500">{f.path}</p>
          </div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (f) => <Badge variant="muted">{f.isFolder ? "folder" : "file"}</Badge>,
    },
    {
      key: "updated",
      header: "Updated",
      cell: (f) => formatDate(f.updated_at || f.created_at),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (f) => (
        <div className="flex flex-wrap gap-1">
          {f.isFolder ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPath(f.path)}
            >
              Open
            </Button>
          ) : (
            <>
              {f.publicUrl && (
                <Button size="sm" variant="outline" asChild>
                  <a href={f.publicUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </Button>
              )}
              {hasPermission("files:write") && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setReplacing(f);
                      fileRef.current?.click();
                    }}
                  >
                    Replace
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void deleteFile(f)}>
                    Delete
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  if (error && !rows.length && !loading) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Files" description="Browse and manage storage buckets" />

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void replaceFile(file);
          e.target.value = "";
        }}
      />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 md:flex-row md:items-end">
          <div className="w-full space-y-1.5 md:w-48">
            <Label>Bucket</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={bucket}
              onChange={(e) => {
                setBucket(e.target.value);
                setPath("");
              }}
            >
              {buckets.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name…"
            />
          </div>
          <div className="flex gap-2">
            {path && (
              <Button
                variant="outline"
                onClick={() => {
                  const parts = path.split("/").filter(Boolean);
                  parts.pop();
                  setPath(parts.join("/"));
                }}
              >
                Up
              </Button>
            )}
            <Button onClick={() => void load()}>Refresh</Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-zinc-500">
        Path: /{path || ""}
      </p>

      {loading ? <LoadingState /> : <DataTable columns={columns} rows={rows} rowKey={(f) => f.path} />}
    </div>
  );
}
