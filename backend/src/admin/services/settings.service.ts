import { env } from "../../env";
import { settingsRepository } from "../repositories/settings.repository";
import { contentRepository } from "../repositories/content.repository";
import { logRepository } from "../repositories/log.repository";
import { sanitizeObjectStrings } from "../utils/sanitize";

type Actor = { id: string; name: string };

const SENSITIVE_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "ADMIN_JWT_SECRET",
  "RESEND_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "OPENAI_API_KEY",
  "BETTER_AUTH_SECRET",
];

export const settingsService = {
  async getAll() {
    const settings = await settingsRepository.getAll();
    return {
      settings,
      safeEnv: {
        NODE_ENV: env.NODE_ENV ?? "development",
        PORT: env.PORT,
        BACKEND_URL: env.BACKEND_URL,
        SUPABASE_URL: env.SUPABASE_URL,
        ADMIN_JWT_EXPIRES_IN: env.ADMIN_JWT_EXPIRES_IN,
        hasServiceRoleKey: !!env.SUPABASE_SERVICE_ROLE_KEY,
        hasResendKey: !!env.RESEND_API_KEY,
        hasGooglePlacesKey: !!env.GOOGLE_PLACES_API_KEY,
        hasAdminJwtSecret: !!env.ADMIN_JWT_SECRET,
      },
      // Never expose secret values — only presence flags above.
      redactedSecrets: SENSITIVE_ENV_KEYS,
    };
  },

  async update(key: string, value: Record<string, unknown>, actor: Actor) {
    const cleaned = sanitizeObjectStrings(value as Record<string, unknown>);
    const row = await settingsRepository.upsert(key, cleaned, actor.id);
    await logRepository.create({
      category: "admin_activity",
      action: "settings_update",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "settings",
      target_id: key,
    });
    return row;
  },

  async listContent() {
    return contentRepository.list();
  },

  async getContent(slug: string) {
    return contentRepository.getBySlug(slug);
  },

  async updateContent(
    slug: string,
    patch: { title?: string; body?: string; is_published?: boolean },
    actor: Actor
  ) {
    const updated = await contentRepository.update(slug, patch, actor.id);
    await logRepository.create({
      category: "admin_activity",
      action: "cms_update",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "content",
      target_id: slug,
    });
    return updated;
  },
};
