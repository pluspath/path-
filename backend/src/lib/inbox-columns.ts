import { supabaseAdmin } from "../supabase";

let inboxColumnsReady: boolean | null = null;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run DDL via exec_sql RPC, falling back to DATABASE_URL when RPC is missing. */
async function runDdl(sql: string): Promise<boolean> {
  const { error: rpcError } = await supabaseAdmin.rpc("exec_sql", { sql });
  if (!rpcError) return true;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn("[inbox] exec_sql failed and DATABASE_URL is not set:", rpcError.message);
    return false;
  }

  try {
    const postgres = (await import("postgres")).default;
    const db = postgres(databaseUrl, { max: 1, ssl: "require" });
    try {
      await db.unsafe(sql);
      return true;
    } finally {
      await db.end({ timeout: 5 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[inbox] DATABASE_URL DDL failed:", message);
    return false;
  }
}

async function probeColumns(): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("conversation_participants")
    .select("pinned_at, hidden_at")
    .limit(1);
  return !error;
}

/**
 * Ensure conversation_participants has pinned_at / hidden_at.
 * Pin + delete-for-me depend on these columns. Safe to call repeatedly.
 */
export async function ensureInboxColumns(): Promise<boolean> {
  if (inboxColumnsReady === true) return true;

  // Fast path: columns already visible to PostgREST.
  if (await probeColumns()) {
    inboxColumnsReady = true;
    return true;
  }

  const statements = [
    "ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;",
    "ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;",
    "CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_hidden ON public.conversation_participants (user_id, hidden_at);",
    "NOTIFY pgrst, 'reload schema';",
  ];

  for (const sql of statements) {
    await runDdl(sql);
  }

  // Schema cache may lag briefly after NOTIFY.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await probeColumns()) {
      inboxColumnsReady = true;
      console.log("[inbox] pinned_at / hidden_at columns ready");
      return true;
    }
    await sleep(250 * (attempt + 1));
  }

  console.warn("[inbox] columns still unavailable after migration attempts");
  inboxColumnsReady = false;
  return false;
}
