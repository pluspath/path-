import type { MiddlewareHandler } from "hono";
import { verifyAdminToken } from "../utils/jwt";
import { adminUserRepository } from "../repositories/admin-user.repository";
import { tokenRepository } from "../repositories/token.repository";
import { permissionsForRole, toPublicAdminUser } from "../utils/permissions";
import { fail } from "../utils/response";
import type { AdminPublicUser } from "../types";
import type { AdminRole } from "../constants";

export type AdminEnv = {
  Variables: {
    adminUser: AdminPublicUser | null;
    adminId: string | null;
    adminRole: AdminRole | null;
    adminJti: string | null;
  };
};

export const adminAuthMiddleware: MiddlewareHandler<AdminEnv> = async (c, next) => {
  c.set("adminUser", null);
  c.set("adminId", null);
  c.set("adminRole", null);
  c.set("adminJti", null);

  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return fail(c, "Unauthorized", 401);
  }

  const token = header.slice(7);
  try {
    const payload = await verifyAdminToken(token);
    if (await tokenRepository.isDenied(payload.jti)) {
      return fail(c, "Token revoked", 401);
    }
    const user = await adminUserRepository.findById(payload.sub);
    if (!user || !user.is_active) {
      return fail(c, "Unauthorized", 401);
    }
    c.set("adminUser", toPublicAdminUser(user) as AdminPublicUser);
    c.set("adminId", user.id);
    c.set("adminRole", user.role);
    c.set("adminJti", payload.jti);
    await next();
  } catch {
    return fail(c, "Invalid or expired token", 401);
  }
};

export function getActor(c: { get: (k: string) => unknown }) {
  const user = c.get("adminUser") as AdminPublicUser | null;
  return {
    id: user?.id ?? "unknown",
    name: user?.username ?? "unknown",
  };
}

export function adminPermissions(c: { get: (k: string) => unknown }) {
  const role = c.get("adminRole") as AdminRole | null;
  if (!role) return [];
  return permissionsForRole(role);
}
