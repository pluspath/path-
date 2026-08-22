import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { supabase, supabaseAdmin, createUserClient } from "./supabase";
import { postsRouter } from "./routes/posts";
import { usersRouter } from "./routes/users";
import { friendsRouter } from "./routes/friends";
import { notificationsRouter } from "./routes/notifications";
import { conversationsRouter } from "./routes/conversations";
import { placesRouter } from "./routes/places";
import { uploadRouter } from "./routes/upload";
import { moderationRouter } from "./routes/moderation";
import { authRouter } from "./routes/auth";
import { configRouter } from "./routes/config";
import { socialRouter } from "./routes/social";
import {
  contentRouter,
  registerMarketingPages,
  seedLegalContent,
} from "./routes/content";
import { adminRouter } from "./admin/routes";
import { bootstrapAdminSystem } from "./admin/bootstrap";
import { apiLimiter } from "./lib/rate-limit";
import { secureHeadersMiddleware } from "./admin/middlewares/secure-headers";
import { backfillJoinedPosts } from "./lib/joined";
import { env, supabaseProjectRef } from "./env";
import type { HonoVariables } from "./types";

const app = new Hono<{ Variables: HonoVariables }>();

// Register public HTML pages immediately (before middleware) so they cannot be missed.
registerMarketingPages(app);
app.get("/__marketing", (c) =>
  c.json({ ok: true, service: "pathplus-api", pages: ["/", "/support", "/privacy", "/terms"] })
);

// Attempt to add profile columns + ensure core RLS policies (graceful if exec_sql missing)
(async () => {
  try {
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = env.SUPABASE_URL;
    if (serviceKey && supabaseUrl) {
      const statements = [
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthday TEXT;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender TEXT;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_age BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_zodiac BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username_changed BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS post_visibility TEXT NOT NULL DEFAULT 'friends';",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE;",
        "ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION;",
        "ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;",
        // Liked Moments queries / reaction toggles — optional timestamp (older DBs lacked it)
        "ALTER TABLE public.reactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();",
        // Messages: align API fields (content/image_url/type) with legacy text/image schema
        "ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS content TEXT;",
        "ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS image_url TEXT;",
        "ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'text';",
        "UPDATE public.messages SET content = text WHERE content IS NULL AND text IS NOT NULL;",
        "UPDATE public.messages SET image_url = image WHERE image_url IS NULL AND image IS NOT NULL;",
        "UPDATE public.messages SET text = content WHERE (text IS NULL OR text = '') AND content IS NOT NULL;",
        "UPDATE public.messages SET image = image_url WHERE image IS NULL AND image_url IS NOT NULL;",
        // Read receipts / unread counts
        "ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;",
        // User blocks table (block/report features)
        `CREATE TABLE IF NOT EXISTS public.user_blocks (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (blocker_id, blocked_id),
          CHECK (blocker_id <> blocked_id)
        );`,
        "CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON public.user_blocks (blocker_id);",
        "CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks (blocked_id);",
        "ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;",
        'DROP POLICY IF EXISTS "Users can view own blocks" ON public.user_blocks;',
        `CREATE POLICY "Users can view own blocks" ON public.user_blocks FOR SELECT TO authenticated USING (auth.uid() = blocker_id);`,
        'DROP POLICY IF EXISTS "Users can create own blocks" ON public.user_blocks;',
        `CREATE POLICY "Users can create own blocks" ON public.user_blocks FOR INSERT TO authenticated WITH CHECK (auth.uid() = blocker_id);`,
        'DROP POLICY IF EXISTS "Users can delete own blocks" ON public.user_blocks;',
        `CREATE POLICY "Users can delete own blocks" ON public.user_blocks FOR DELETE TO authenticated USING (auth.uid() = blocker_id);`,
        // Service-role inserts already bypass RLS; also allow SELECT of blocks involving me (either side)
        'DROP POLICY IF EXISTS "Users can view blocks involving them" ON public.user_blocks;',
        `CREATE POLICY "Users can view blocks involving them" ON public.user_blocks FOR SELECT TO authenticated USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);`,
        // Hot-path indexes for messaging performance
        "CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages (conversation_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON public.conversation_participants (user_id);",
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications (user_id, created_at DESC);",
        // Fix participants RLS without recursion (SECURITY DEFINER helper)
        `CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id uuid)
          RETURNS boolean
          LANGUAGE sql
          SECURITY DEFINER
          SET search_path = public
          STABLE
          AS $$ SELECT EXISTS (
            SELECT 1 FROM public.conversation_participants
            WHERE conversation_id = conv_id AND user_id = auth.uid()
          ); $$;`,
        'DROP POLICY IF EXISTS "Participants can view participants" ON public.conversation_participants;',
        `CREATE POLICY "Participants can view participants" ON public.conversation_participants FOR SELECT TO authenticated USING (public.is_conversation_participant(conversation_id));`,
        'DROP POLICY IF EXISTS "Participants can update own row" ON public.conversation_participants;',
        `CREATE POLICY "Participants can update own row" ON public.conversation_participants FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`,
        // Posts bucket should accept videos
        `UPDATE storage.buckets SET file_size_limit = 52428800, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'] WHERE id = 'Posts';`,
        // Critical posts RLS — fixes 42501 on POST /api/posts when policies were never applied
        "ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;",
        'DROP POLICY IF EXISTS "Anyone can view posts" ON public.posts;',
        'DROP POLICY IF EXISTS "Users can create posts" ON public.posts;',
        'DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;',
        'DROP POLICY IF EXISTS "Users can delete own posts" ON public.posts;',
        'CREATE POLICY "Anyone can view posts" ON public.posts FOR SELECT USING (true);',
        `CREATE POLICY "Users can create posts" ON public.posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);`,
        `CREATE POLICY "Users can update own posts" ON public.posts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`,
        `CREATE POLICY "Users can delete own posts" ON public.posts FOR DELETE TO authenticated USING (auth.uid() = user_id);`,
        // Saved posts (minimal bootstrap if 006 not applied yet)
        `CREATE TABLE IF NOT EXISTS public.saved_posts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
          post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, post_id)
        );`,
        "CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON public.saved_posts (user_id, created_at DESC);",
        "ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;",
        'DROP POLICY IF EXISTS "Users can view own saved posts" ON public.saved_posts;',
        `CREATE POLICY "Users can view own saved posts" ON public.saved_posts FOR SELECT TO authenticated USING (auth.uid() = user_id);`,
        'DROP POLICY IF EXISTS "Users can save posts" ON public.saved_posts;',
        `CREATE POLICY "Users can save posts" ON public.saved_posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);`,
        'DROP POLICY IF EXISTS "Users can unsave posts" ON public.saved_posts;',
        `CREATE POLICY "Users can unsave posts" ON public.saved_posts FOR DELETE TO authenticated USING (auth.uid() = user_id);`,
        'DROP POLICY IF EXISTS "Users can update own saved posts" ON public.saved_posts;',
        `CREATE POLICY "Users can update own saved posts" ON public.saved_posts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`,
      ];
      for (const sql of statements) {
        const { error } = await supabaseAdmin.rpc("exec_sql", { sql });
        if (error) {
          console.warn(`[migration] exec_sql failed: ${error.message}`);
        }
      }
      console.log("[migration] column + posts RLS + social bootstrap finished");
    }
  } catch {
    console.log(
      "[migration] column/RLS migrations may not have run — run: bun run migrate:admin (see migrations/004_rls_policies.sql)."
    );
  }

  // One-time idempotent backfill: ensure every existing user has a "Joined
  // Path+" moment as the oldest item on their timeline.
  await backfillJoinedPosts();
})();

// Surface Supabase connectivity problems immediately in logs (no secrets).
(async () => {
  const project = supabaseProjectRef(env.SUPABASE_URL);
  try {
    const { error } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if (error) {
      console.error(`[supabase] Startup check failed for project "${project}": ${error.message}`);
    } else {
      console.log(`[supabase] Connected to project "${project}"`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[supabase] Unreachable project "${project}" (${message}). ` +
        "Update SUPABASE_URL / keys in backend .env to your active project, then restart."
    );
  }
})();

const isProd = process.env.NODE_ENV === "production";

const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  // Private LAN only (dev) — not public internet IPs
  /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
];

const extraAdminOrigins = (env.ADMIN_CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use("*", cors({
  origin: (origin) => {
    // Native mobile clients often omit Origin; allow those requests (no browser CORS).
    if (!origin) return "*";
    if (extraAdminOrigins.includes(origin)) return origin;
    if (
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin) ||
      /\.expo\.dev$/.test(origin) ||
      origin.includes("exp.direct") ||
      allowed.some((re) => re.test(origin))
    ) {
      return origin;
    }
    // Production: only explicitly configured admin origins
    if (isProd) return extraAdminOrigins.includes(origin) ? origin : null;
    return null;
  },
  credentials: true,
}));

// Bootstrap admin tables/seed (idempotent; never touches mobile auth)
bootstrapAdminSystem()
  .then(() => seedLegalContent())
  .catch((err) => {
    console.warn("[admin] bootstrap error:", err instanceof Error ? err.message : err);
  });

app.use("*", logger());
app.use("/api/admin/*", secureHeadersMiddleware);
app.use("/api/*", apiLimiter);

app.use("*", async (c, next) => {
  c.set("user", null);
  c.set("userId", null);
  c.set("accessToken", null);

  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const { data: { user: authUser }, error } = await supabase.auth.getUser(token);

      if (authUser && !error) {
        c.set("userId", authUser.id);
        c.set("accessToken", token);

        const userClient = createUserClient(token);
        const { data: profile } = await userClient
          .from("profiles")
          .select("*")
          .eq("id", authUser.id)
          .single();

        c.set("user", profile ?? null);
      } else if (error) {
        console.warn(`[auth] Token rejected: ${error.message}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[auth] Supabase unreachable (${supabaseProjectRef(env.SUPABASE_URL)}): ${message}`
      );
    }
  }

  await next();
});

app.get("/health", async (c) => {
  // /health?ready=1 → admin login diagnostics (same handler as /health so it cannot 404)
  if (c.req.query("ready") === "1") {
    let adminTablesOk = false;
    let adminUserCount: number | null = null;
    let tablesMessage = "ok";
    try {
      const { count, error } = await supabaseAdmin
        .from("admin_users")
        .select("id", { count: "exact", head: true });
      if (error) tablesMessage = error.message;
      else {
        adminTablesOk = true;
        adminUserCount = count ?? 0;
      }
    } catch (e) {
      tablesMessage = e instanceof Error ? e.message : String(e);
    }

    const jwtConfigured = Boolean(env.ADMIN_JWT_SECRET && env.ADMIN_JWT_SECRET.length >= 32);
    const serviceRoleConfigured = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

    return c.json({
      status: "ok",
      data: {
        jwtConfigured,
        serviceRoleConfigured,
        adminTablesOk,
        adminUserCount,
        tablesMessage,
        backendUrl: env.BACKEND_URL,
        canLogin:
          jwtConfigured && serviceRoleConfigured && adminTablesOk && (adminUserCount ?? 0) > 0,
      },
    });
  }

  return c.json({ status: "ok", service: "pathplus-api", marketing: true });
});

app.get("/admin-ready", async (c) => {
  // Keep alias; primary diagnostics live at /health?ready=1
  const url = new URL(c.req.url);
  url.pathname = "/health";
  url.searchParams.set("ready", "1");
  return app.fetch(new Request(url.toString(), c.req.raw));
});

app.get("/health/supabase", async (c) => {
  const project = supabaseProjectRef(env.SUPABASE_URL);
  try {
    const { error } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });

    if (error) {
      return c.json({
        status: "error",
        project,
        message: error.message,
      }, 503);
    }

    return c.json({ status: "ok", project });
  } catch (err) {
    return c.json({
      status: "error",
      project,
      message: err instanceof Error ? err.message : "Connection failed",
    }, 503);
  }
});

app.get("/api/admin/auth/ready", async (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/health";
  url.searchParams.set("ready", "1");
  return app.fetch(new Request(url.toString(), c.req.raw));
});

app.route("/api/content", contentRouter);
app.route("/api/config", configRouter);
app.route("/api/auth", authRouter);
app.route("/api/posts", postsRouter);
app.route("/api/friends", friendsRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/conversations", conversationsRouter);
app.route("/api/places", placesRouter);
app.route("/api/upload", uploadRouter);
app.route("/api/social", socialRouter);
app.route("/api/admin", adminRouter);
// Moderation (/api/reports, /api/blocks) must be mounted BEFORE usersRouter so
// its concrete paths aren't captured by usersRouter's "/:id".
app.route("/api", moderationRouter);
app.route("/api", usersRouter);

const port = Number(process.env.PORT) || 3000;

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: (req) => app.fetch(req),
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[boot] FATAL: cannot bind :${port} — ${message}`);
  console.error("[boot] Another process is probably still holding the port. Run: bash deploy/restart-api-clean.sh");
  process.exit(1);
}

console.log(
  `[boot] Path+ API listening on http://${server.hostname}:${server.port} (pid ${process.pid}) | GET /__marketing`
);

// Named export only — do NOT `export default app` (Bun would try to serve it again).
export { app, server };
