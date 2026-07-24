import { env, supabaseProjectRef } from "../../env";
import { supabaseAdmin } from "../../supabase";

export const healthService = {
  async check() {
    const started = Date.now();
    let supabaseOk = false;
    let supabaseMessage = "ok";
    let profileCount: number | null = null;

    try {
      const { count, error } = await supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (error) {
        supabaseMessage = error.message;
      } else {
        supabaseOk = true;
        profileCount = count ?? 0;
      }
    } catch (e) {
      supabaseMessage = e instanceof Error ? e.message : String(e);
    }

    let adminTablesOk = false;
    try {
      const { error } = await supabaseAdmin
        .from("admin_users")
        .select("id", { count: "exact", head: true });
      adminTablesOk = !error;
    } catch {
      adminTablesOk = false;
    }

    return {
      status: supabaseOk && adminTablesOk ? "healthy" : "degraded",
      uptimeMs: Math.round(process.uptime() * 1000),
      latencyMs: Date.now() - started,
      runtime: {
        bun: typeof Bun !== "undefined" ? Bun.version : null,
        nodeEnv: env.NODE_ENV ?? "development",
        port: env.PORT,
        backendUrl: env.BACKEND_URL,
      },
      supabase: {
        ok: supabaseOk,
        project: supabaseProjectRef(env.SUPABASE_URL),
        message: supabaseMessage,
        profileCount,
      },
      adminTables: { ok: adminTablesOk },
      timestamp: new Date().toISOString(),
    };
  },
};
