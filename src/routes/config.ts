import { Hono } from "hono";
import { env } from "../env";
import { supabaseAdmin } from "../supabase";
import type { HonoVariables } from "../types";

/**
 * Public app configuration for mobile clients.
 * Exposes only non-secret values needed to bootstrap the app.
 * Service-role keys, Resend, Google Places, and admin secrets never leave the server.
 */
const configRouter = new Hono<{ Variables: HonoVariables }>();

configRouter.get("/", async (c) => {
  let supportEmail = "support@pathplus.app";
  let appName = "Path+";
  let minAppVersion = "1.0.0";

  try {
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("key, value")
      .in("key", ["general", "safe_env"]);

    for (const row of data ?? []) {
      const value = (row.value ?? {}) as Record<string, unknown>;
      if (row.key === "general") {
        if (typeof value.supportEmail === "string" && value.supportEmail) {
          supportEmail = value.supportEmail;
        }
        if (typeof value.appName === "string" && value.appName) {
          appName = value.appName;
        }
        if (typeof value.minAppVersion === "string" && value.minAppVersion) {
          minAppVersion = value.minAppVersion;
        }
      }
      if (row.key === "safe_env" && typeof value.supportEmail === "string" && value.supportEmail) {
        supportEmail = value.supportEmail;
      }
    }
  } catch {
    // Settings table may not exist yet — use defaults
  }

  return c.json({
    data: {
      appName,
      supportEmail,
      minAppVersion,
      // Public Supabase credentials (anon key is designed for client use with RLS).
      // Mobile should prefer these over hardcoding keys in the binary / EAS env.
      supabaseUrl: env.SUPABASE_URL,
      supabaseAnonKey: env.SUPABASE_ANON_KEY,
      features: {
        savedPosts: true,
        trending: true,
        hashtags: true,
        mentions: true,
        blockUser: true,
        reportContent: true,
        sharePosts: true,
        searchUsers: true,
        suggestedFriends: true,
      },
      momentTypes: ["thought", "location", "sleep", "wakeup"],
      maxFriends: 150,
      maxUploadBytes: 25 * 1024 * 1024,
    },
  });
});

export { configRouter };
