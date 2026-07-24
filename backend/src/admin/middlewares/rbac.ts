import type { MiddlewareHandler } from "hono";
import type { Permission } from "../constants";
import { roleHasPermission } from "../utils/permissions";
import { fail } from "../utils/response";
import type { AdminEnv } from "./admin-auth";

export function requirePermission(...permissions: Permission[]): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const role = c.get("adminRole");
    if (!role) return fail(c, "Unauthorized", 401);
    const ok = permissions.every((p) => roleHasPermission(role, p));
    if (!ok) return fail(c, "Forbidden — insufficient permissions", 403);
    await next();
  };
}
