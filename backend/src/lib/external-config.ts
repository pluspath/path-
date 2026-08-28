import { env } from "../env";
import { decryptSecret } from "./secret-crypto";
import { externalServicesRepository, type ExternalServiceRow } from "../admin/repositories/external-services.repository";

/**
 * Central resolver for external-service configuration.
 * Priority: environment variables (production) → Admin DB (encrypted secrets + configuration).
 * Cache is process-local and invalidated on admin updates.
 */

export type ExternalServiceId = "email" | "supabase" | "push" | "google_places";

export type EmailConfig = {
  enabled: boolean;
  provider: "resend";
  apiKey: string | null;
  apiKeySource: "database" | "env" | "none";
  fromEmail: string;
  fromName: string;
  replyTo: string;
  publicAppUrl: string;
  templates: {
    signupOtp: { subject: string; enabled: boolean };
    passwordResetOtp: { subject: string; enabled: boolean };
    accountDeletion: { subject: string; enabled: boolean };
  };
};

type CacheEntry = {
  at: number;
  rows: Map<string, ExternalServiceRow>;
};

const CACHE_TTL_MS = 30_000;
let cache: CacheEntry | null = null;

const DEFAULT_TEMPLATES = {
  signupOtp: { subject: "Your verification code", enabled: true },
  passwordResetOtp: { subject: "Your Path+ password reset code", enabled: true },
  accountDeletion: {
    subject: "Your Path+ account is suspended for 30 days",
    enabled: true,
  },
};

function defaultPublicAppUrl(): string {
  const configured = env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const backend = env.BACKEND_URL?.trim().replace(/\/+$/, "") ?? "";
  if (backend && !/localhost|127\.0\.0\.1/i.test(backend)) {
    try {
      if (/api\.pathplus\.store$/i.test(new URL(backend).hostname)) {
        return "https://site.pathplus.store";
      }
    } catch {
      /* ignore */
    }
  }
  return "https://site.pathplus.store";
}

export function invalidateExternalConfigCache(): void {
  cache = null;
}

async function loadRows(): Promise<Map<string, ExternalServiceRow>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  try {
    const list = await externalServicesRepository.list();
    const rows = new Map(list.map((r) => [r.service, r]));
    cache = { at: now, rows };
    return rows;
  } catch (e) {
    // Table may not exist yet — fall back to empty map / env-only.
    console.warn(
      "[external-config] could not load settings (using env fallback):",
      e instanceof Error ? e.message : "unknown"
    );
    cache = { at: now, rows: new Map() };
    return cache.rows;
  }
}

function parseSecrets(row: ExternalServiceRow | undefined): Record<string, string> {
  if (!row?.encrypted_secrets) return {};
  try {
    const json = decryptSecret(row.encrypted_secrets);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
    return out;
  } catch (e) {
    console.error(
      "[external-config] failed to decrypt secrets for",
      row.service,
      e instanceof Error ? e.message : "unknown"
    );
    return {};
  }
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const rows = await loadRows();
  const row = rows.get("email");
  const secrets = parseSecrets(row);
  const cfg = (row?.configuration ?? {}) as Record<string, unknown>;
  const templatesRaw = (cfg.templates ?? {}) as Record<string, Record<string, unknown>>;

  const envKey = env.RESEND_API_KEY?.trim() || null;
  const dbKey = secrets.apiKey?.trim() || null;
  // Production .env must win over a stale Admin DB key (common misconfiguration).
  const apiKey = envKey || dbKey;
  const apiKeySource: EmailConfig["apiKeySource"] = envKey
    ? "env"
    : dbKey
      ? "database"
      : "none";

  const fromName =
    (typeof cfg.fromName === "string" && cfg.fromName.trim()) || "Path+";

  const envFrom = env.RESEND_FROM_EMAIL?.trim() || "";
  const dbFrom =
    typeof cfg.fromEmail === "string" && cfg.fromEmail.trim() ? cfg.fromEmail.trim() : "";
  // Production .env sender must win over stale Admin DB fromEmail.
  const rawFrom = envFrom || dbFrom;

  let fromEmail: string;
  if (!rawFrom) {
    fromEmail = "Resend <onboarding@resend.dev>";
  } else if (rawFrom.includes("<")) {
    fromEmail = rawFrom;
  } else {
    fromEmail = `${fromName} <${rawFrom}>`;
  }

  const publicAppUrl =
    (typeof cfg.publicAppUrl === "string" && cfg.publicAppUrl.trim().replace(/\/+$/, "")) ||
    defaultPublicAppUrl();

  const mergeTemplate = (
    key: keyof typeof DEFAULT_TEMPLATES
  ): { subject: string; enabled: boolean } => {
    const t = templatesRaw[key] ?? {};
    return {
      subject:
        typeof t.subject === "string" && t.subject.trim()
          ? t.subject.trim()
          : DEFAULT_TEMPLATES[key].subject,
      enabled: typeof t.enabled === "boolean" ? t.enabled : DEFAULT_TEMPLATES[key].enabled,
    };
  };

  return {
    enabled: row ? row.enabled !== false : true,
    provider: "resend",
    apiKey,
    apiKeySource,
    fromEmail,
    fromName,
    replyTo: typeof cfg.replyTo === "string" ? cfg.replyTo.trim() : "",
    publicAppUrl,
    templates: {
      signupOtp: mergeTemplate("signupOtp"),
      passwordResetOtp: mergeTemplate("passwordResetOtp"),
      accountDeletion: mergeTemplate("accountDeletion"),
    },
  };
}

export async function getGooglePlacesApiKey(): Promise<string | null> {
  const rows = await loadRows();
  const row = rows.get("google_places");
  if (row && row.enabled === false) return null;
  const secrets = parseSecrets(row);
  return secrets.apiKey?.trim() || env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

export async function isPushEnabled(): Promise<boolean> {
  const rows = await loadRows();
  const row = rows.get("push");
  if (!row) return true;
  return row.enabled !== false;
}

export async function getServiceRow(service: ExternalServiceId): Promise<ExternalServiceRow | null> {
  const rows = await loadRows();
  return rows.get(service) ?? null;
}

/** Trusted hosts for PUBLIC_APP_URL / branding links (open-redirect prevention). */
export const TRUSTED_PUBLIC_APP_HOSTS = new Set([
  "site.pathplus.store",
  "www.pathplus.store",
  "pathplus.store",
  "api.pathplus.store",
  "admin.pathplus.store",
]);

export function isAllowedPublicAppUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Allow http only for local development hosts
    if (u.protocol === "http:" && !/^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) {
      return false;
    }
    if (u.protocol === "https:" && TRUSTED_PUBLIC_APP_HOSTS.has(u.hostname.toLowerCase())) {
      return true;
    }
    // Localhost allowed for non-production admin testing of branding only
    if (/^(localhost|127\.0\.0\.1)$/i.test(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}
