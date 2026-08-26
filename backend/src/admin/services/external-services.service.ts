import { z } from "zod";
import { env, supabaseProjectRef } from "../../env";
import { supabaseAdmin } from "../../supabase";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "../../lib/secret-crypto";
import {
  getEmailConfig,
  getGooglePlacesApiKey,
  invalidateExternalConfigCache,
  isAllowedPublicAppUrl,
  isPushEnabled,
  type ExternalServiceId,
} from "../../lib/external-config";
import {
  sendEmail,
  testEmailProviderConnection,
} from "../../lib/email-service";
import {
  externalServicesRepository,
  type ExternalServiceRow,
} from "../repositories/external-services.repository";
import { logRepository } from "../repositories/log.repository";
import { clientKey } from "../../lib/rate-limit";

type Actor = { id: string; name: string };

const SERVICES: ExternalServiceId[] = ["email", "supabase", "push", "google_places"];

const SERVICE_META: Record<
  ExternalServiceId,
  { name: string; type: string; description: string }
> = {
  email: {
    name: "Email (Resend)",
    type: "email",
    description: "Transactional email for signup OTP, password reset OTP, and account notices.",
  },
  supabase: {
    name: "Supabase",
    type: "database_auth_storage",
    description: "Database, Auth, and Storage. Service role key remains server-side only.",
  },
  push: {
    name: "Push Notifications (Expo)",
    type: "push",
    description: "Expo Push API. No server API secret required for standard delivery.",
  },
  google_places: {
    name: "Google Places",
    type: "maps",
    description: "Server-side Places Nearby Search for check-ins.",
  },
};

/** In-memory rate limit for test emails: max 5 per admin per hour. */
const testEmailBuckets = new Map<string, number[]>();

function allowTestEmail(adminId: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const prev = (testEmailBuckets.get(adminId) ?? []).filter((t) => now - t < windowMs);
  if (prev.length >= 5) {
    testEmailBuckets.set(adminId, prev);
    return false;
  }
  prev.push(now);
  testEmailBuckets.set(adminId, prev);
  return true;
}

function publicStatus(row: ExternalServiceRow | null, service: ExternalServiceId) {
  const meta = SERVICE_META[service];
  const configured = isServiceConfigured(service, row);
  return {
    service,
    name: meta.name,
    type: meta.type,
    description: meta.description,
    enabled: row ? row.enabled !== false : true,
    configured,
    secretFieldsConfigured: row?.secret_fields ?? [],
    lastTestAt: row?.last_test_at ?? null,
    lastTestOk: row?.last_test_ok ?? null,
    lastTestMessage: row?.last_test_message ?? null,
    updatedAt: row?.updated_at ?? null,
    // Safe non-secret configuration only
    configuration: sanitizeConfigForClient(service, row?.configuration ?? {}),
  };
}

function sanitizeConfigForClient(
  service: ExternalServiceId,
  cfg: Record<string, unknown>
): Record<string, unknown> {
  if (service === "email") {
    return {
      provider: "resend",
      fromEmail: typeof cfg.fromEmail === "string" ? cfg.fromEmail : "",
      fromName: typeof cfg.fromName === "string" ? cfg.fromName : "Path+",
      replyTo: typeof cfg.replyTo === "string" ? cfg.replyTo : "",
      publicAppUrl: typeof cfg.publicAppUrl === "string" ? cfg.publicAppUrl : "",
      templates: cfg.templates && typeof cfg.templates === "object" ? cfg.templates : {},
      apiKeyConfigured: false, // filled by caller via secret_fields / env
    };
  }
  return { ...cfg };
}

function isServiceConfigured(service: ExternalServiceId, row: ExternalServiceRow | null): boolean {
  switch (service) {
    case "email": {
      const hasDb = (row?.secret_fields ?? []).includes("apiKey");
      const hasEnv = !!env.RESEND_API_KEY?.trim();
      return hasDb || hasEnv;
    }
    case "supabase":
      return !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
    case "push":
      return true; // Expo push requires no server secret
    case "google_places": {
      const hasDb = (row?.secret_fields ?? []).includes("apiKey");
      const hasEnv = !!env.GOOGLE_PLACES_API_KEY?.trim();
      return hasDb || hasEnv;
    }
    default:
      return false;
  }
}

async function audit(
  actor: Actor,
  action: string,
  service: string,
  metadata: Record<string, unknown> = {},
  ip?: string | null
) {
  await logRepository.create({
    category: "admin_activity",
    action,
    actor_type: "admin",
    actor_id: actor.id,
    actor_name: actor.name,
    target_type: "external_service",
    target_id: service,
    metadata,
    ip_address: ip ?? null,
  });
}

export const emailUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  fromEmail: z.string().max(200).optional(),
  fromName: z.string().max(120).optional(),
  replyTo: z.string().max(200).optional(),
  publicAppUrl: z.string().max(500).optional(),
  /** Replace API key — omit or empty to keep existing */
  apiKey: z.string().min(10).max(500).optional(),
  clearApiKey: z.boolean().optional(),
  confirmHighRisk: z.boolean().optional(),
  templates: z
    .object({
      signupOtp: z
        .object({
          subject: z.string().min(1).max(200).optional(),
          enabled: z.boolean().optional(),
        })
        .optional(),
      passwordResetOtp: z
        .object({
          subject: z.string().min(1).max(200).optional(),
          enabled: z.boolean().optional(),
        })
        .optional(),
      accountDeletion: z
        .object({
          subject: z.string().min(1).max(200).optional(),
          enabled: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const googlePlacesUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().min(10).max(500).optional(),
  clearApiKey: z.boolean().optional(),
  confirmHighRisk: z.boolean().optional(),
});

export const pushUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

export const supabaseUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  /** Optional: store encrypted service role override — NEVER returned */
  serviceRoleKey: z.string().min(20).max(2000).optional(),
  clearServiceRoleKey: z.boolean().optional(),
  confirmHighRisk: z.boolean().optional(),
});

export const testEmailSchema = z.object({
  to: z.string().email(),
});

export const externalServicesService = {
  async list() {
    let rows: ExternalServiceRow[] = [];
    try {
      rows = await externalServicesRepository.list();
    } catch {
      rows = [];
    }
    const byService = new Map(rows.map((r) => [r.service, r]));
    const emailCfg = await getEmailConfig();

    return {
      encryptionConfigured: isEncryptionConfigured(),
      services: SERVICES.map((service) => {
        const row = byService.get(service) ?? null;
        const status = publicStatus(row, service);
        if (service === "email") {
          status.configuration = {
            ...status.configuration,
            apiKeyConfigured: emailCfg.apiKeySource !== "none",
            apiKeySource: emailCfg.apiKeySource,
            effectiveFromEmail: emailCfg.fromEmail,
            effectivePublicAppUrl: emailCfg.publicAppUrl,
          };
        }
        if (service === "supabase") {
          status.configuration = {
            ...status.configuration,
            supabaseUrl: env.SUPABASE_URL,
            projectRef: supabaseProjectRef(env.SUPABASE_URL),
            anonKeyConfigured: !!env.SUPABASE_ANON_KEY,
            serviceRoleKeyConfigured: !!env.SUPABASE_SERVICE_ROLE_KEY,
            // Never include actual keys
          };
        }
        if (service === "google_places") {
          status.configuration = {
            ...status.configuration,
            apiKeyConfigured: isServiceConfigured("google_places", row),
            apiKeySource: (row?.secret_fields ?? []).includes("apiKey")
              ? "database"
              : env.GOOGLE_PLACES_API_KEY
                ? "env"
                : "none",
          };
        }
        if (service === "push") {
          status.configuration = {
            ...status.configuration,
            provider: "expo",
            expoPushEndpoint: "https://exp.host/--/api/v2/push/send",
          };
        }
        return status;
      }),
    };
  },

  async get(service: ExternalServiceId) {
    const all = await this.list();
    const item = all.services.find((s) => s.service === service);
    if (!item) throw new Error("Service not found");
    return { encryptionConfigured: all.encryptionConfigured, service: item };
  },

  async updateEmail(
    patch: z.infer<typeof emailUpdateSchema>,
    actor: Actor,
    ip?: string | null
  ) {
    const highRisk =
      !!patch.apiKey || !!patch.clearApiKey || patch.enabled === false;
    if (highRisk && !patch.confirmHighRisk) {
      throw new Error("High-risk change requires confirmHighRisk: true");
    }
    if (patch.publicAppUrl !== undefined && patch.publicAppUrl.trim()) {
      if (!isAllowedPublicAppUrl(patch.publicAppUrl)) {
        throw new Error(
          "publicAppUrl is not on the trusted allowlist. Use an approved Path+ domain."
        );
      }
    }

    const existing = await externalServicesRepository.get("email");
    const configuration = {
      ...(existing?.configuration ?? {}),
      provider: "resend",
      fromEmail: patch.fromEmail ?? (existing?.configuration?.fromEmail as string) ?? "",
      fromName: patch.fromName ?? (existing?.configuration?.fromName as string) ?? "Path+",
      replyTo: patch.replyTo ?? (existing?.configuration?.replyTo as string) ?? "",
      publicAppUrl:
        patch.publicAppUrl ?? (existing?.configuration?.publicAppUrl as string) ?? "",
      templates: {
        ...((existing?.configuration?.templates as object) ?? {}),
        ...(patch.templates ?? {}),
      },
    };

    let encrypted_secrets = existing?.encrypted_secrets ?? null;
    let secret_fields = [...(existing?.secret_fields ?? [])];

    if (patch.clearApiKey) {
      encrypted_secrets = null;
      secret_fields = secret_fields.filter((f) => f !== "apiKey");
    } else if (patch.apiKey) {
      if (!isEncryptionConfigured()) {
        throw new Error(
          "CONFIG_ENCRYPTION_KEY must be set before storing API keys in the database."
        );
      }
      const secrets = encrypted_secrets
        ? (JSON.parse(decryptSecret(encrypted_secrets)) as Record<string, string>)
        : {};
      secrets.apiKey = patch.apiKey;
      encrypted_secrets = encryptSecret(JSON.stringify(secrets));
      if (!secret_fields.includes("apiKey")) secret_fields.push("apiKey");
    }

    const row = await externalServicesRepository.upsert({
      service: "email",
      enabled: patch.enabled,
      configuration,
      encrypted_secrets,
      secret_fields,
      updated_by: actor.id,
    });

    invalidateExternalConfigCache();
    await audit(
      actor,
      patch.apiKey
        ? "external_service_email_api_key_replaced"
        : patch.clearApiKey
          ? "external_service_email_api_key_cleared"
          : "external_service_email_updated",
      "email",
      {
        enabled: row.enabled,
        fields: Object.keys(patch).filter((k) => k !== "apiKey" && k !== "confirmHighRisk"),
        apiKeyChanged: !!patch.apiKey || !!patch.clearApiKey,
      },
      ip
    );

    return this.get("email");
  },

  async updateGooglePlaces(
    patch: z.infer<typeof googlePlacesUpdateSchema>,
    actor: Actor,
    ip?: string | null
  ) {
    const highRisk = !!patch.apiKey || !!patch.clearApiKey || patch.enabled === false;
    if (highRisk && !patch.confirmHighRisk) {
      throw new Error("High-risk change requires confirmHighRisk: true");
    }

    const existing = await externalServicesRepository.get("google_places");
    let encrypted_secrets = existing?.encrypted_secrets ?? null;
    let secret_fields = [...(existing?.secret_fields ?? [])];

    if (patch.clearApiKey) {
      encrypted_secrets = null;
      secret_fields = secret_fields.filter((f) => f !== "apiKey");
    } else if (patch.apiKey) {
      if (!isEncryptionConfigured()) {
        throw new Error(
          "CONFIG_ENCRYPTION_KEY must be set before storing API keys in the database."
        );
      }
      const secrets = encrypted_secrets
        ? (JSON.parse(decryptSecret(encrypted_secrets)) as Record<string, string>)
        : {};
      secrets.apiKey = patch.apiKey;
      encrypted_secrets = encryptSecret(JSON.stringify(secrets));
      if (!secret_fields.includes("apiKey")) secret_fields.push("apiKey");
    }

    await externalServicesRepository.upsert({
      service: "google_places",
      enabled: patch.enabled,
      configuration: existing?.configuration ?? {},
      encrypted_secrets,
      secret_fields,
      updated_by: actor.id,
    });

    invalidateExternalConfigCache();
    await audit(
      actor,
      patch.apiKey
        ? "external_service_google_places_key_replaced"
        : "external_service_google_places_updated",
      "google_places",
      { apiKeyChanged: !!patch.apiKey || !!patch.clearApiKey, enabled: patch.enabled },
      ip
    );
    return this.get("google_places");
  },

  async updatePush(
    patch: z.infer<typeof pushUpdateSchema>,
    actor: Actor,
    ip?: string | null
  ) {
    const existing = await externalServicesRepository.get("push");
    await externalServicesRepository.upsert({
      service: "push",
      enabled: patch.enabled,
      configuration: {
        ...(existing?.configuration ?? {}),
        provider: "expo",
        notes: patch.notes ?? (existing?.configuration?.notes as string) ?? "",
      },
      updated_by: actor.id,
    });
    invalidateExternalConfigCache();
    await audit(actor, "external_service_push_updated", "push", { enabled: patch.enabled }, ip);
    return this.get("push");
  },

  async updateSupabase(
    patch: z.infer<typeof supabaseUpdateSchema>,
    actor: Actor,
    ip?: string | null
  ) {
    // Service role key stays in server env only — never stored via Admin API.
    // This endpoint only toggles enabled + records audit for operational clarity.
    if (patch.serviceRoleKey || patch.clearServiceRoleKey) {
      throw new Error(
        "The Supabase service role key cannot be set via the Admin API. Configure SUPABASE_SERVICE_ROLE_KEY on the server environment."
      );
    }

    const highRisk = patch.enabled === false;
    if (highRisk && !patch.confirmHighRisk) {
      throw new Error("High-risk change requires confirmHighRisk: true");
    }

    const existing = await externalServicesRepository.get("supabase");
    await externalServicesRepository.upsert({
      service: "supabase",
      enabled: patch.enabled,
      configuration: existing?.configuration ?? {
        notes:
          "URL and anon key remain server env / public client config. Service role key is server-only (env).",
      },
      updated_by: actor.id,
    });

    invalidateExternalConfigCache();
    await audit(
      actor,
      "external_service_supabase_updated",
      "supabase",
      { enabled: patch.enabled },
      ip
    );
    return this.get("supabase");
  },

  async test(service: ExternalServiceId, actor: Actor, ip?: string | null) {
    let result: { ok: boolean; message: string };

    switch (service) {
      case "email":
        result = await testEmailProviderConnection();
        break;
      case "supabase":
        result = await testSupabaseConnection();
        break;
      case "push": {
        const enabled = await isPushEnabled();
        result = enabled
          ? {
              ok: true,
              message:
                "Expo Push is enabled. Delivery uses https://exp.host/--/api/v2/push/send (no API key required).",
            }
          : { ok: false, message: "Push notifications are disabled in Admin settings." };
        break;
      }
      case "google_places":
        result = await testGooglePlacesConnection();
        break;
      default:
        result = { ok: false, message: "Unknown service." };
    }

    try {
      await externalServicesRepository.recordTest(service, result);
    } catch {
      /* ignore */
    }

    await audit(
      actor,
      "external_service_test",
      service,
      { ok: result.ok, message: result.message },
      ip
    );

    return result;
  },

  async sendTestEmail(to: string, actor: Actor, ip?: string | null) {
    if (!allowTestEmail(actor.id)) {
      throw Object.assign(new Error("Too many test emails. Try again later."), {
        status: 429,
      });
    }

    const result = await sendEmail({
      to,
      subject: "Path+ Email Configuration Test",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #0A1F44;">Path+ Email Configuration Test</h2>
          <p style="color: #475569; line-height: 1.6;">
            This is a test email from the Path+ administration panel.
          </p>
          <p style="color: #94A3B8; font-size: 13px;">If you received this, email delivery is working.</p>
        </div>
      `,
    });

    await audit(
      actor,
      "external_service_email_test_send",
      "email",
      { ok: result.ok, toDomain: to.split("@")[1] ?? "unknown" },
      ip
    );

    if (!result.ok) {
      throw new Error(result.message);
    }
    return { ok: true, message: "Test email sent." };
  },
};

async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const url = env.SUPABASE_URL;
    if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co/i.test(url)) {
      return { ok: false, message: "Supabase URL is missing or not a trusted supabase.co host." };
    }
    const { count, error } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if (error) {
      console.error("[external-services] supabase test:", error.message);
      return { ok: false, message: "The external service configuration is invalid." };
    }
    return {
      ok: true,
      message: `Connection successful (project ${supabaseProjectRef(url)}, profiles≈${count ?? 0}).`,
    };
  } catch (e) {
    console.error(
      "[external-services] supabase test exception:",
      e instanceof Error ? e.message : "unknown"
    );
    return { ok: false, message: "Could not reach Supabase." };
  }
}

async function testGooglePlacesConnection(): Promise<{ ok: boolean; message: string }> {
  const key = await getGooglePlacesApiKey();
  if (!key) {
    return { ok: false, message: "Configuration incomplete — API key is missing." };
  }
  try {
    // Fixed Google endpoint only — no user-controlled URL (SSRF-safe).
    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName",
      },
      body: JSON.stringify({
        locationRestriction: {
          circle: { center: { latitude: 25.2048, longitude: 55.2708 }, radius: 100 },
        },
        maxResultCount: 1,
      }),
    });
    if (response.status === 200 || response.status === 400) {
      // 400 can mean valid key but bad request shape — still proves auth often returns 403 for bad keys
      const text = await response.text();
      if (/API_KEY_INVALID|PERMISSION_DENIED|REQUEST_DENIED/i.test(text)) {
        return { ok: false, message: "Authentication failed. Check the API key." };
      }
      return { ok: true, message: "Connection successful." };
    }
    if (response.status === 403 || response.status === 401) {
      return { ok: false, message: "Authentication failed. Check the API key." };
    }
    return { ok: false, message: "Provider rejected the connection." };
  } catch (e) {
    console.error(
      "[external-services] places test:",
      e instanceof Error ? e.message : "unknown"
    );
    return { ok: false, message: "Could not reach Google Places." };
  }
}

export function parseServiceId(raw: string): ExternalServiceId | null {
  if (SERVICES.includes(raw as ExternalServiceId)) return raw as ExternalServiceId;
  return null;
}
