"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleAlert,
  Cable,
  Mail,
  Database,
  Bell,
  MapPin,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ServiceId = "email" | "supabase" | "push" | "google_places";

type ServiceStatus = {
  service: ServiceId;
  name: string;
  type: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  secretFieldsConfigured: string[];
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  updatedAt: string | null;
  configuration: Record<string, unknown>;
};

type ListPayload = {
  encryptionConfigured: boolean;
  services: ServiceStatus[];
};

const ICONS: Record<ServiceId, typeof Mail> = {
  email: Mail,
  supabase: Database,
  push: Bell,
  google_places: MapPin,
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? "success" : "warning"} className="gap-1">
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
      {label}
    </Badge>
  );
}

export default function ExternalServicesPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("settings:write");
  const [data, setData] = useState<ListPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ data: ListPayload }>("/external-services")
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function testService(service: ServiceId) {
    setBusy(`test:${service}`);
    try {
      const r = await api.post<{ data: { ok: boolean; message: string } }>(
        `/external-services/${service}/test`,
        {}
      );
      if (r.data.ok) toast.success(r.data.message);
      else toast.error(r.data.message);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  const editingService = data.services.find((s) => s.service === editing) ?? null;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Settings"
        title="External Services"
        description="Manage integrations and credentials. Secrets are encrypted server-side and never shown again after save."
        actions={
          <Button variant="outline" asChild>
            <Link href="/settings">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              General settings
            </Link>
          </Button>
        }
      />

      {!data.encryptionConfigured ? (
        <Card className="border-amber-300/80 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-base">Encryption key required</CardTitle>
            <CardDescription>
              Set <code className="font-mono text-xs">CONFIG_ENCRYPTION_KEY</code> on the API
              server (64-char hex from <code className="font-mono text-xs">openssl rand -hex 32</code>)
              before storing API keys in the database. Existing environment variables continue to work
              as a fallback.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {data.services.map((svc) => {
          const Icon = ICONS[svc.service];
          return (
            <Card key={svc.service}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy/5 text-navy dark:bg-gold/10 dark:text-gold">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{svc.name}</CardTitle>
                    <CardDescription className="mt-1 max-w-xl">{svc.description}</CardDescription>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge
                        ok={svc.configured}
                        label={svc.configured ? "Configured ✓" : "Not configured"}
                      />
                      <Badge variant={svc.enabled ? "success" : "muted"}>
                        {svc.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Badge variant="muted" className="font-mono text-[10px] uppercase">
                        {svc.type}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap gap-2">
                  {canWrite ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === `test:${svc.service}`}
                        onClick={() => void testService(svc.service)}
                      >
                        {busy === `test:${svc.service}` ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Cable className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Test Connection
                      </Button>
                      <Button size="sm" onClick={() => setEditing(svc.service)}>
                        Edit Configuration
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 border-t pt-4 text-sm text-muted">
                {svc.lastTestAt ? (
                  <p>
                    Last test:{" "}
                    <span className={svc.lastTestOk ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}>
                      {svc.lastTestOk ? "Success" : "Failed"}
                    </span>
                    {" · "}
                    {new Date(svc.lastTestAt).toLocaleString()}
                    {svc.lastTestMessage ? ` — ${svc.lastTestMessage}` : null}
                  </p>
                ) : (
                  <p>No connection test recorded yet.</p>
                )}
                {svc.service === "email" && svc.configuration.apiKeyConfigured ? (
                  <p>
                    API Key: Configured ✓
                    {svc.configuration.apiKeySource
                      ? ` (source: ${String(svc.configuration.apiKeySource)})`
                      : null}
                  </p>
                ) : null}
                {svc.service === "supabase" ? (
                  <div className="space-y-1 font-mono text-xs">
                    <p>URL: {String(svc.configuration.supabaseUrl ?? "—")}</p>
                    <p>
                      Anon key:{" "}
                      {svc.configuration.anonKeyConfigured ? "Configured ✓" : "Missing"}
                    </p>
                    <p>
                      Service Role Key:{" "}
                      {svc.configuration.serviceRoleKeyConfigured
                        ? "Configured ✓"
                        : "Not configured"}
                    </p>
                  </div>
                ) : null}
                {svc.service === "google_places" && svc.configuration.apiKeyConfigured ? (
                  <p>API Key: Configured ✓ · ••••••••••••</p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editingService ? (
        <ServiceEditor
          service={editingService}
          canWrite={canWrite}
          encryptionConfigured={data.encryptionConfigured}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function ServiceEditor({
  service,
  canWrite,
  encryptionConfigured,
  onClose,
  onSaved,
}: {
  service: ServiceStatus;
  canWrite: boolean;
  encryptionConfigured: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmHighRisk, setConfirmHighRisk] = useState(false);
  const cfg = service.configuration;

  // Email form
  const [enabled, setEnabled] = useState(service.enabled);
  const [fromEmail, setFromEmail] = useState(String(cfg.fromEmail ?? ""));
  const [fromName, setFromName] = useState(String(cfg.fromName ?? "Path+"));
  const [replyTo, setReplyTo] = useState(String(cfg.replyTo ?? ""));
  const [publicAppUrl, setPublicAppUrl] = useState(String(cfg.publicAppUrl ?? ""));
  const [apiKey, setApiKey] = useState("");
  const [signupSubject, setSignupSubject] = useState(
    String((cfg.templates as any)?.signupOtp?.subject ?? "Your verification code")
  );
  const [resetSubject, setResetSubject] = useState(
    String((cfg.templates as any)?.passwordResetOtp?.subject ?? "Your Path+ password reset code")
  );
  const [testTo, setTestTo] = useState("");
  const [notes, setNotes] = useState(String(cfg.notes ?? ""));

  async function save() {
    if (!canWrite) return;
    setBusy(true);
    try {
      if (service.service === "email") {
        if ((apiKey.trim() || !enabled) && !confirmHighRisk) {
          toast.error("Confirm the high-risk change checkbox first.");
          setBusy(false);
          return;
        }
        const body: Record<string, unknown> = {
          enabled,
          fromEmail,
          fromName,
          replyTo,
          publicAppUrl,
          templates: {
            signupOtp: { subject: signupSubject, enabled: true },
            passwordResetOtp: { subject: resetSubject, enabled: true },
          },
        };
        if (apiKey.trim()) {
          body.apiKey = apiKey.trim();
          body.confirmHighRisk = true;
        }
        if (!enabled) body.confirmHighRisk = true;
        await api.patch(`/external-services/email`, body);
      } else if (service.service === "google_places") {
        const body: Record<string, unknown> = { enabled };
        if (apiKey.trim()) {
          body.apiKey = apiKey.trim();
          body.confirmHighRisk = true;
        }
        if (!enabled) body.confirmHighRisk = true;
        if ((body.apiKey || !enabled) && !confirmHighRisk) {
          toast.error("Confirm the high-risk change checkbox first.");
          setBusy(false);
          return;
        }
        await api.patch(`/external-services/google_places`, body);
      } else if (service.service === "push") {
        await api.patch(`/external-services/push`, { enabled, notes });
      } else if (service.service === "supabase") {
        const body: Record<string, unknown> = { enabled };
        if (!enabled) {
          if (!confirmHighRisk) {
            toast.error("Confirm the high-risk change checkbox first.");
            setBusy(false);
            return;
          }
          body.confirmHighRisk = true;
        }
        await api.patch(`/external-services/supabase`, body);
      }
      toast.success("Configuration saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEmail() {
    if (!testTo.trim()) {
      toast.error("Enter a recipient email");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/external-services/email/send-test`, { to: testTo.trim() });
      toast.success("Test email sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-4 backdrop-blur-[2px] sm:items-center">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto shadow-xl">
        <CardHeader>
          <CardTitle>Edit {service.name}</CardTitle>
          <CardDescription>
            Secrets are write-only. After saving, only “Configured ✓” is shown — never the original
            value.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>

          {service.service === "email" ? (
            <>
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Input value="Resend" disabled />
              </div>
              <div className="space-y-1.5">
                <Label>From name</Label>
                <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>From email</Label>
                <Input
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="noreply@pathplus.store"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Reply-To</Label>
                <Input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Public app URL (email footer — allowlisted domains only)</Label>
                <Input
                  value={publicAppUrl}
                  onChange={(e) => setPublicAppUrl(e.target.value)}
                  placeholder="https://site.pathplus.store"
                />
              </div>
              <div className="space-y-1.5">
                <Label>API Key</Label>
                {cfg.apiKeyConfigured ? (
                  <p className="text-sm text-muted">Configured ✓ · ••••••••••••</p>
                ) : (
                  <p className="text-sm text-amber-700">Not configured</p>
                )}
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={cfg.apiKeyConfigured ? "Replace API key…" : "Enter Resend API key"}
                  disabled={!encryptionConfigured && !cfg.apiKeyConfigured}
                />
                {!encryptionConfigured ? (
                  <p className="text-xs text-amber-700">
                    Set CONFIG_ENCRYPTION_KEY on the server to store a new key in the database.
                    Env RESEND_API_KEY still works as fallback.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>Signup OTP subject</Label>
                <Input value={signupSubject} onChange={(e) => setSignupSubject(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Password reset OTP subject</Label>
                <Input value={resetSubject} onChange={(e) => setResetSubject(e.target.value)} />
              </div>
              <div className="rounded-xl border p-3 space-y-2">
                <Label>Send test email</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="you@example.com"
                  />
                  <Button variant="outline" disabled={busy} onClick={() => void sendTestEmail()}>
                    Send
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {service.service === "google_places" ? (
            <div className="space-y-1.5">
              <Label>API Key</Label>
              {cfg.apiKeyConfigured ? (
                <p className="text-sm text-muted">Configured ✓ · ••••••••••••</p>
              ) : (
                <p className="text-sm text-amber-700">Not configured</p>
              )}
              <Input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Replace server-side Places API key…"
              />
            </div>
          ) : null}

          {service.service === "push" ? (
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              <p className="text-xs text-muted">
                Expo Push does not require a server API secret for standard delivery.
              </p>
            </div>
          ) : null}

          {service.service === "supabase" ? (
            <>
              <div className="space-y-1 font-mono text-xs rounded-xl border p-3">
                <p>URL: {String(cfg.supabaseUrl ?? "—")}</p>
                <p>Anon key: {cfg.anonKeyConfigured ? "Configured ✓" : "Missing"}</p>
                <p>
                  Service Role Key:{" "}
                  {cfg.serviceRoleKeyConfigured ? "Configured ✓" : "Not configured"}
                </p>
              </div>
              <p className="text-xs text-muted">
                The service role key must be set as{" "}
                <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> on the API server.
                It is never accepted or returned through the Admin API.
              </p>
            </>
          ) : null}

          {(service.service === "google_places" && apiKey) ||
          (service.service === "supabase" && !enabled) ||
          (service.service === "email" && (apiKey || !enabled)) ||
          (service.service !== "push" && !enabled) ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmHighRisk}
                onChange={(e) => setConfirmHighRisk(e.target.checked)}
              />
              <span>
                I confirm this high-risk change (credential replace and/or disabling a service).
              </span>
            </label>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || !canWrite} onClick={() => void save()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
