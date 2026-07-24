export const ADMIN_ROLES = ["super_admin", "admin", "moderator"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_HIERARCHY: Record<AdminRole, number> = {
  super_admin: 100,
  admin: 50,
  moderator: 10,
};

/** Permission matrix — moderators are read-heavy; admins manage content; super_admin full. */
export const PERMISSIONS = {
  "dashboard:read": ["super_admin", "admin", "moderator"],
  "users:read": ["super_admin", "admin", "moderator"],
  "users:write": ["super_admin", "admin"],
  "users:delete": ["super_admin"],
  "users:suspend": ["super_admin", "admin"],
  "posts:read": ["super_admin", "admin", "moderator"],
  "posts:write": ["super_admin", "admin", "moderator"],
  "posts:delete": ["super_admin", "admin"],
  "comments:read": ["super_admin", "admin", "moderator"],
  "comments:write": ["super_admin", "admin", "moderator"],
  "comments:delete": ["super_admin", "admin", "moderator"],
  "friendships:read": ["super_admin", "admin", "moderator"],
  "friendships:write": ["super_admin", "admin"],
  "notifications:read": ["super_admin", "admin", "moderator"],
  "notifications:send": ["super_admin", "admin"],
  "reports:read": ["super_admin", "admin", "moderator"],
  "reports:write": ["super_admin", "admin", "moderator"],
  "settings:read": ["super_admin", "admin"],
  "settings:write": ["super_admin"],
  "cms:read": ["super_admin", "admin", "moderator"],
  "cms:write": ["super_admin", "admin"],
  "files:read": ["super_admin", "admin", "moderator"],
  "files:write": ["super_admin", "admin"],
  "logs:read": ["super_admin", "admin"],
  "admins:read": ["super_admin"],
  "admins:write": ["super_admin"],
  "health:read": ["super_admin", "admin", "moderator"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const JWT_ISSUER = "pathplus-admin";
export const JWT_AUDIENCE = "pathplus-admin-dashboard";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
