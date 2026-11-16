import postgres from "postgres";
import { supabaseAdmin } from "../supabase";

let repathColumnReady: boolean | null = null;

/** Run DDL via exec_sql RPC, falling back to DATABASE_URL when RPC is missing. */
async function runDdl(sql: string): Promise<boolean> {
  const { error: rpcError } = await supabaseAdmin.rpc("exec_sql", { sql });
  if (!rpcError) return true;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn("[schema] exec_sql failed and DATABASE_URL is not set:", rpcError.message);
    return false;
  }

  try {
    const db = postgres(databaseUrl, { max: 1, ssl: "require" });
    try {
      await db.unsafe(sql);
      return true;
    } finally {
      await db.end({ timeout: 5 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[schema] DATABASE_URL DDL failed:", message);
    return false;
  }
}

/** Create exec_sql helper so later migrations can run without DATABASE_URL. */
async function ensureExecSqlFunction(): Promise<boolean> {
  return runDdl(`
    CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
    BEGIN
      EXECUTE sql;
    END;
    $$;
    REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.exec_sql(text) FROM anon;
    REVOKE ALL ON FUNCTION public.exec_sql(text) FROM authenticated;
  `);
}

/** Ensure repath_of exists on posts (required for Repath). Safe to call repeatedly. */
export async function ensureRepathColumn(): Promise<boolean> {
  if (repathColumnReady === true) return true;

  await ensureExecSqlFunction();

  const ok = await runDdl(
    "ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS repath_of UUID REFERENCES public.posts(id) ON DELETE SET NULL;"
  );

  if (ok) {
    repathColumnReady = true;
    console.log("[schema] repath_of column ready");
    // Force PostgREST to pick up the new column (avoids PGRST204 schema cache errors).
    await runDdl("NOTIFY pgrst, 'reload schema';");
  } else {
    console.warn("[schema] Could not ensure repath_of column");
  }

  return ok;
}

let themePreferenceReady: boolean | null = null;

/** Persist the user's light/dark/system choice on their profile. */
export async function ensureThemePreferenceColumn(): Promise<boolean> {
  if (themePreferenceReady === true) return true;
  await ensureExecSqlFunction();
  const ok = await runDdl(
    "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS theme_preference text DEFAULT 'light';"
  );
  if (ok) {
    await runDdl("ALTER TABLE public.profiles ALTER COLUMN theme_preference SET DEFAULT 'light';");
  }
  if (ok) {
    themePreferenceReady = true;
    console.log("[schema] theme_preference column ready");
    await runDdl("NOTIFY pgrst, 'reload schema';");
  } else {
    console.warn("[schema] Could not ensure theme_preference column");
  }
  return ok;
}

let verifiedColumnReady: boolean | null = null;

/**
 * Account verification badge. Existing and new profiles stay unverified
 * until an administrator grants the badge.
 */
export async function ensureVerifiedColumn(): Promise<boolean> {
  if (verifiedColumnReady === true) return true;
  await ensureExecSqlFunction();
  const ok = await runDdl(`
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verified_at timestamptz;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verified_by text;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verification_revoked_at timestamptz;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verification_revoked_by text;
  `);
  if (ok) {
    verifiedColumnReady = true;
    console.log("[schema] is_verified column ready");
    await runDdl("NOTIFY pgrst, 'reload schema';");
  } else {
    console.warn("[schema] Could not ensure is_verified column");
  }
  return ok;
}

/** Probe whether repath_of is usable (cached after first successful ensure). */
export async function isRepathColumnReady(): Promise<boolean> {
  if (repathColumnReady === true) return true;
  return ensureRepathColumn();
}

let contentLocationReady: boolean | null = null;

/** Additive location metadata on posts + comments (display + capture meta). */
export async function ensureContentLocationColumns(): Promise<boolean> {
  if (contentLocationReady === true) return true;
  await ensureExecSqlFunction();
  const ok = await runDdl(`
    ALTER TABLE public.posts
      ADD COLUMN IF NOT EXISTS location_city text,
      ADD COLUMN IF NOT EXISTS location_region text,
      ADD COLUMN IF NOT EXISTS location_country text,
      ADD COLUMN IF NOT EXISTS location_accuracy_m double precision,
      ADD COLUMN IF NOT EXISTS location_precision text,
      ADD COLUMN IF NOT EXISTS location_captured_at timestamptz,
      ADD COLUMN IF NOT EXISTS location_shared boolean DEFAULT false;
    ALTER TABLE public.comments
      ADD COLUMN IF NOT EXISTS location_label text,
      ADD COLUMN IF NOT EXISTS location_city text,
      ADD COLUMN IF NOT EXISTS location_region text,
      ADD COLUMN IF NOT EXISTS location_country text,
      ADD COLUMN IF NOT EXISTS location_lat double precision,
      ADD COLUMN IF NOT EXISTS location_lng double precision,
      ADD COLUMN IF NOT EXISTS location_accuracy_m double precision,
      ADD COLUMN IF NOT EXISTS location_precision text,
      ADD COLUMN IF NOT EXISTS location_captured_at timestamptz,
      ADD COLUMN IF NOT EXISTS location_shared boolean DEFAULT false;
  `);
  if (ok) {
    contentLocationReady = true;
    console.log("[schema] content location columns ready");
    await runDdl("NOTIFY pgrst, 'reload schema';");
  } else {
    console.warn("[schema] Could not ensure content location columns");
  }
  return ok;
}

let pollsReady: boolean | null = null;

/** Verified-account polls tables. Additive; safe to re-run. */
export async function ensurePollTables(): Promise<boolean> {
  if (pollsReady === true) return true;
  await ensureExecSqlFunction();
  const ok = await runDdl(`
    CREATE TABLE IF NOT EXISTS public.polls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
      question text NOT NULL,
      created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (post_id)
    );
    CREATE TABLE IF NOT EXISTS public.poll_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
      text text NOT NULL,
      position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS public.poll_votes (
      poll_id uuid NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
      option_id uuid NOT NULL REFERENCES public.poll_options(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (poll_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_poll_options_poll_id ON public.poll_options(poll_id);
    CREATE INDEX IF NOT EXISTS idx_poll_votes_option_id ON public.poll_votes(option_id);
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_id ON public.poll_votes(poll_id);
    ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;
  `);
  if (ok) {
    pollsReady = true;
    console.log("[schema] poll tables ready");
    await runDdl("NOTIFY pgrst, 'reload schema';");
  } else {
    console.warn("[schema] Could not ensure poll tables");
  }
  return ok;
}
