"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SettingsPayload = {
  settings: { key: string; value: Record<string, unknown> }[];
  safeEnv: Record<string, unknown>;
  redactedSecrets?: string[];
};

type GeneralSettings = {
  appName: string;
  logoUrl: string;
  contactEmail: string;
  contactPhone: string;
  social: string;
  maintenanceMode: boolean;
};

const defaultGeneral: GeneralSettings = {
  appName: "Path+",
  logoUrl: "",
  contactEmail: "",
  contactPhone: "",
  social: "",
  maintenanceMode: false,
};

export default function SettingsPage() {
  const { hasPermission } = useAuth();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [general, setGeneral] = useState<GeneralSettings>(defaultGeneral);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ data: SettingsPayload }>("/settings")
      .then((r) => {
        setData(r.data);
        const row = r.data.settings?.find((s) => s.key === "general");
        const value = (row?.value || {}) as Partial<GeneralSettings>;
        setGeneral({
          appName: String(value.appName ?? defaultGeneral.appName),
          logoUrl: String(value.logoUrl ?? ""),
          contactEmail: String(value.contactEmail ?? ""),
          contactPhone: String(value.contactPhone ?? ""),
          social: String(value.social ?? ""),
          maintenanceMode: Boolean(value.maintenanceMode),
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load settings"));
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.put("/settings", { key: "general", value: general });
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        title="Settings"
        description="Application configuration and environment overview"
        actions={
          hasPermission("settings:write") ? (
            <Button disabled={busy} onClick={() => void save()}>
              Save general settings
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Public-facing app metadata and maintenance flag</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>App name</Label>
            <Input
              disabled={!hasPermission("settings:write")}
              value={general.appName}
              onChange={(e) => setGeneral((g) => ({ ...g, appName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Logo URL</Label>
            <Input
              disabled={!hasPermission("settings:write")}
              value={general.logoUrl}
              onChange={(e) => setGeneral((g) => ({ ...g, logoUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact email</Label>
            <Input
              disabled={!hasPermission("settings:write")}
              value={general.contactEmail}
              onChange={(e) => setGeneral((g) => ({ ...g, contactEmail: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact phone</Label>
            <Input
              disabled={!hasPermission("settings:write")}
              value={general.contactPhone}
              onChange={(e) => setGeneral((g) => ({ ...g, contactPhone: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Social links</Label>
            <Input
              disabled={!hasPermission("settings:write")}
              value={general.social}
              onChange={(e) => setGeneral((g) => ({ ...g, social: e.target.value }))}
              placeholder="instagram.com/…, x.com/…"
            />
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              disabled={!hasPermission("settings:write")}
              checked={general.maintenanceMode}
              onChange={(e) => setGeneral((g) => ({ ...g, maintenanceMode: e.target.checked }))}
            />
            Maintenance mode
            {general.maintenanceMode ? <Badge variant="warning">enabled</Badge> : null}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Safe environment</CardTitle>
          <CardDescription>Read-only runtime values (secrets never shown)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(data.safeEnv || {}).map(([key, value]) => (
              <div key={key} className="rounded-xl border px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-zinc-500">{key}</p>
                <p className="mt-1 break-all font-mono text-sm">{String(value)}</p>
              </div>
            ))}
          </div>
          {data.redactedSecrets?.length ? (
            <p className="mt-4 text-xs text-zinc-500">
              Redacted secrets: {data.redactedSecrets.join(", ")}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
