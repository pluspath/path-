import { env } from "../../env";
import { supabaseAdmin } from "../../supabase";

/** Public admin login readiness (no secrets). */
export async function getAdminAuthReady() {
  let adminTablesOk = false;
  let adminUserCount: number | null = null;
  let tablesMessage = "ok";

  try {
    const { count, error } = await supabaseAdmin
      .from("admin_users")
      .select("id", { count: "exact", head: true });
    if (error) {
      tablesMessage = error.message;
    } else {
      adminTablesOk = true;
      adminUserCount = count ?? 0;
    }
  } catch (e) {
    tablesMessage = e instanceof Error ? e.message : String(e);
  }

  const jwtConfigured = Boolean(env.ADMIN_JWT_SECRET && env.ADMIN_JWT_SECRET.length >= 32);
  const serviceRoleConfigured = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);

  return {
    jwtConfigured,
    serviceRoleConfigured,
    adminTablesOk,
    adminUserCount,
    tablesMessage,
    backendUrl: env.BACKEND_URL,
    canLogin:
      jwtConfigured && serviceRoleConfigured && adminTablesOk && (adminUserCount ?? 0) > 0,
  };
}
