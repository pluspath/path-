import { supabaseAdmin } from "../supabase";

/** Run a DDL statement via exec_sql (no-op if RPC is missing). */
async function execSql(sql: string): Promise<boolean> {
  const { error } = await supabaseAdmin.rpc("exec_sql", { sql });
  if (error) {
    console.warn("[schema] exec_sql failed:", error.message);
    return false;
  }
  return true;
}

/** Ensure repath_of exists so POST /api/posts with repathOf succeeds. */
export async function ensureRepathColumn(): Promise<boolean> {
  return execSql(
    "ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS repath_of UUID REFERENCES public.posts(id) ON DELETE SET NULL;"
  );
}

/** Ensure post_views exists for read-receipt stats on moments. */
export async function ensurePostViewsTable(): Promise<boolean> {
  return execSql(
    `CREATE TABLE IF NOT EXISTS public.post_views (
      post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_post_views_post ON public.post_views (post_id, viewed_at DESC);`
  );
}
