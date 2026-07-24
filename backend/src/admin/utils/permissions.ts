import { PERMISSIONS, type AdminRole, type Permission } from "../constants";

export function roleHasPermission(role: AdminRole, permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly string[];
  return allowed.includes(role);
}

export function permissionsForRole(role: AdminRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => roleHasPermission(role, p));
}

export function toPublicAdminUser<T extends { password_hash?: string }>(user: T): Omit<T, "password_hash"> {
  const { password_hash: _, ...rest } = user;
  return rest;
}
