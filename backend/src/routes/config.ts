import { Hono } from "hono";
import { env } from "../env";

/**
 * Public, non-secret app configuration for mobile clients.
 * NEVER include service-role keys, JWT secrets, DB credentials, or API keys.
 */
const configRouter = new Hono();

configRouter.get("/", (c) => {
  return c.json({
    data: {
      appName: "Path+",
      supportEmail: "support@pathplus.store",
      minAppVersion: "1.0.0",
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
      momentTypes: [
        "photo",
        "video",
        "text",
        "location",
        "music",
        "activity",
        "meal",
        "sleep",
      ],
      maxFriends: 500,
      maxUploadBytes: 50 * 1024 * 1024,
    },
  });
});

export { configRouter };
