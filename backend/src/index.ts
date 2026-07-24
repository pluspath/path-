import "@vibecodeapp/proxy";
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
import { adminRouter } from "./admin/routes";
import { bootstrapAdminSystem } from "./admin/bootstrap";
import { env, supabaseProjectRef } from "./env";
import type { HonoVariables } from "./types";

const app = new Hono<{ Variables: HonoVariables }>();

// Attempt to add push_token column to profiles (gracefully handles if already exists or if it fails)
(async () => {
  try {
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = env.SUPABASE_URL;
    if (serviceKey && supabaseUrl) {
      await supabaseAdmin.rpc('exec_sql', { sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;' });
      await supabaseAdmin.rpc('exec_sql', { sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birthday TEXT;' });
      await supabaseAdmin.rpc('exec_sql', { sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_zodiac BOOLEAN DEFAULT FALSE;' });
      await supabaseAdmin.rpc('exec_sql', { sql: 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username_changed BOOLEAN DEFAULT FALSE;' });
    }
  } catch {
    console.log('[migration] column migrations may not have run - ensure birthday, show_zodiac, username_changed columns exist in profiles table.');
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
        "Update SUPABASE_URL / keys in backend .env (or ENV tab) to your active project, then restart."
    );
  }
})();

const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/\d{1,3}(\.\d{1,3}){3}(:\d+)?$/,
  /^https:\/\/\d{1,3}(\.\d{1,3}){3}(:\d+)?$/,
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
    // Native mobile clients often omit Origin; allow those requests.
    if (!origin) return "*";
    if (extraAdminOrigins.includes(origin)) return origin;
    return allowed.some((re) => re.test(origin)) ? origin : null;
  },
  credentials: true,
}));

// Bootstrap admin tables/seed (idempotent; never touches mobile auth)
bootstrapAdminSystem().catch((err) => {
  console.warn("[admin] bootstrap error:", err instanceof Error ? err.message : err);
});

app.use("*", logger());

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
        supabaseUrl: env.SUPABASE_URL,
        message: error.message,
      }, 503);
    }

    return c.json({ status: "ok", project, supabaseUrl: env.SUPABASE_URL });
  } catch (err) {
    return c.json({
      status: "error",
      project,
      supabaseUrl: env.SUPABASE_URL,
      message: err instanceof Error ? err.message : "Connection failed",
    }, 503);
  }
});

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
