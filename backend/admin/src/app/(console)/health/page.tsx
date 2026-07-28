"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type HealthData = {
  status: string;
  uptimeMs: number;
  latencyMs: number;
  runtime: {
    bun: string | null;
    nodeEnv: string;
    port: number;
    backendUrl: string;
  };
  supabase: {
    ok: boolean;
    project: string | null;
    message: string;
    profileCount: number | null;
  };
  adminTables: { ok: boolean };
  timestamp: string;
};

function formatUptime(ms: number) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: HealthData }>("/health");
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Health check failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorState message={error} />;
  if (loading && !data) return <LoadingState />;
  if (!data) return null;

  const healthy = data.status === "healthy";

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Operations" title="System Health"
        description="Runtime, database, and admin table status"
        actions={
          <Button
            variant="outline"
            onClick={() =>
              void load().then(() => toast.success("Health refreshed")).catch(() => undefined)
            }
          >
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Overall</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl capitalize">
              {data.status}
              <Badge variant={healthy ? "success" : "warning"}>{healthy ? "OK" : "Check"}</Badge>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Latency</CardDescription>
            <CardTitle className="text-2xl">{formatNumber(data.latencyMs)} ms</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Uptime</CardDescription>
            <CardTitle className="text-2xl">{formatUptime(data.uptimeMs)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Checked at</CardDescription>
            <CardTitle className="text-base font-medium">{formatDate(data.timestamp)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Runtime</CardTitle>
            <CardDescription>Process environment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Bun:</span> {data.runtime.bun || "n/a"}
            </p>
            <p>
              <span className="text-slate-500">NODE_ENV:</span> {data.runtime.nodeEnv}
            </p>
            <p>
              <span className="text-slate-500">Port:</span> {data.runtime.port}
            </p>
            <p className="break-all">
              <span className="text-slate-500">Backend URL:</span> {data.runtime.backendUrl}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Supabase</CardTitle>
              <Badge variant={data.supabase.ok ? "success" : "danger"}>
                {data.supabase.ok ? "connected" : "error"}
              </Badge>
            </div>
            <CardDescription>Database connectivity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Project:</span> {data.supabase.project || "â€”"}
            </p>
            <p>
              <span className="text-slate-500">Profiles:</span>{" "}
              {data.supabase.profileCount == null ? "â€”" : formatNumber(data.supabase.profileCount)}
            </p>
            <p>
              <span className="text-slate-500">Message:</span> {data.supabase.message}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Admin tables</CardTitle>
              <Badge variant={data.adminTables.ok ? "success" : "danger"}>
                {data.adminTables.ok ? "ready" : "missing"}
              </Badge>
            </div>
            <CardDescription>admin_users and related schema</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-500">
            {data.adminTables.ok
              ? "Admin schema is reachable."
              : "Could not query admin tables. Run migrations if needed."}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
