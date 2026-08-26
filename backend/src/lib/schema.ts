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

/** Probe whether repath_of is usable (cached after first successful ensure). */
export async function isRepathColumnReady(): Promise<boolean> {
  if (repathColumnReady === true) return true;
  return ensureRepathColumn();
}
