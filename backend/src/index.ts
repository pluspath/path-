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
import { authRouter } from "./routes/auth";
import { configRouter } from "./routes/config";
import { socialRouter } from "./routes/social";
import { reportsRouter } from "./routes/reports";
import { blocksRouter } from "./routes/blocks";
import { adminRouter } from "./admin/routes";
import { bootstrapAdminSystem } from "./admin/bootstrap";
import { apiLimiter } from "./lib/rate-limit";
import { secureHeadersMiddleware } from "./admin/middlewares/secure-headers";
import { env, supabaseProjectRef } from "./env";
import type { HonoVariables } from "./types";

const app = new Hono<{ Variables: HonoVariables }>();

// Attempt to add profile columns + ensure core RLS policies (graceful if exec_sql missing)
(async () => {
  try {
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = env.SUPABASE_URL;
    if (serviceKey && supabaseUrl) {
      const statements = [
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthday TEXT;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_zodiac BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username_changed BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS post_visibility TEXT NOT NULL DEFAULT 'friends';",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;",
        "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE;",
        "ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION;",
        "ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;",
        // Messages: align API fields (content/image_url/type) with legacy text/image schema
        "ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS content TEXT;",
        "ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS image_url TEXT;",
        "ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'text';",
        "UPDATE public.messages SET content = text WHERE content IS NULL AND text IS NOT NULL;",
        "UPDATE public.messages SET image_url = image WHERE image_url IS NULL AND image IS NOT NULL;",
        "UPDATE public.messages SET text = content WHERE (text IS NULL OR text = '') AND content IS NOT NULL;",
        "UPDATE public.messages SET image = image_url WHERE image IS NULL AND image_url IS NOT NULL;",
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
    // Production: only explicitly configured admin origins
    if (isProd) return null;
    return allowed.some((re) => re.test(origin)) ? origin : null;
  },
  credentials: true,
}));

// Bootstrap admin tables/seed (idempotent; never touches mobile auth)
bootstrapAdminSystem().catch((err) => {
  console.warn("[admin] bootstrap error:", err instanceof Error ? err.message : err);
});

app.use("*", logger());
app.use("*", secureHeadersMiddleware);
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

app.get("/health", (c) => c.json({ status: "ok" }));

/** Instant admin login diagnostics (no nested routers, no dynamic import). */
app.get("/admin-ready", async (c) => {
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

// Alias under /api/admin for the dashboard/scripts
app.get("/api/admin/auth/ready", async (c) => {
  const res = await app.request("/admin-ready");
  return new Response(res.body, {
    status: res.status,
    headers: res.headers,
  });
});

app.route("/api/config", configRouter);
app.route("/api/auth", authRouter);
app.route("/api/posts", postsRouter);
app.route("/api/friends", friendsRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/conversations", conversationsRouter);
app.route("/api/places", placesRouter);
app.route("/api/upload", uploadRouter);
app.route("/api/social", socialRouter);
app.route("/api/reports", reportsRouter);
app.route("/api/blocks", blocksRouter);
app.route("/api/admin", adminRouter);
app.route("/api", usersRouter);

const port = Number(process.env.PORT) || 3000;

export default { port, fetch: app.fetch };
