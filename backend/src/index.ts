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
      ];
      for (const sql of statements) {
        const { error } = await supabaseAdmin.rpc("exec_sql", { sql });
        if (error) {
          console.warn(`[migration] exec_sql failed: ${error.message}`);
        }
      }
      console.log("[migration] column + posts RLS bootstrap finished");
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

app.route("/api/config", configRouter);
app.route("/api/auth", authRouter);
app.route("/api/posts", postsRouter);
app.route("/api/friends", friendsRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/conversations", conversationsRouter);
app.route("/api/places", placesRouter);
app.route("/api/upload", uploadRouter);
app.route("/api/admin", adminRouter);
app.route("/api", usersRouter);

const port = Number(process.env.PORT) || 3000;

export default { port, fetch: app.fetch };
