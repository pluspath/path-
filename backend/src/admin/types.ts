import type { AdminRole, Permission } from "./constants";

export type AdminUser = {
  id: string;
  username: string;
  password_hash: string;
  role: AdminRole;
  display_name: string | null;
  email: string | null;
  is_active: boolean;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminPublicUser = Omit<AdminUser, "password_hash">;

export type AdminJwtPayload = {
  sub: string;
  username: string;
  role: AdminRole;
  jti: string;
};

export type AdminVariables = {
  adminUser: AdminPublicUser | null;
  adminId: string | null;
  adminRole: AdminRole | null;
  adminJti: string | null;
  adminPermissions: Permission[];
};

export type PaginationQuery = {
  page: number;
  limit: number;
  search?: string;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type LogCategory =
  | "admin_login"
  | "admin_login_failed"
  | "admin_activity"
  | "user_activity"
  | "api_error"
  | "unhandled_exception"
  | "system";
