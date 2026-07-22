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
import type { HonoVariables } from "./types";

const app = new Hono<{ Variables: HonoVariables }>();

// Attempt to add push_token column to profiles (gracefully handles if already exists or if it fails)
(async () => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
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

const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
];

app.use("*", cors({
  origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
  credentials: true,
}));

app.use("*", logger());

app.use("*", async (c, next) => {
  c.set("user", null);
  c.set("userId", null);
  c.set("accessToken", null);

  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
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
    }
  }

  await next();
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/auth", authRouter);
app.route("/api/posts", postsRouter);
app.route("/api/friends", friendsRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/conversations", conversationsRouter);
app.route("/api/places", placesRouter);
app.route("/api/upload", uploadRouter);
app.route("/api", usersRouter);

const port = Number(process.env.PORT) || 3000;

export default { port, fetch: app.fetch };
