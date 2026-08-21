import { createHash, randomBytes } from "crypto";
import { adminUserRepository } from "../repositories/admin-user.repository";
import { tokenRepository } from "../repositories/token.repository";
import { logRepository } from "../repositories/log.repository";
import { hashPassword, verifyPassword } from "../utils/password";
import { signAdminToken, verifyAdminToken } from "../utils/jwt";
import { permissionsForRole, toPublicAdminUser } from "../utils/permissions";
import type { AdminPublicUser } from "../types";

export class AuthError extends Error {
  constructor(
    message: string,
    public status: 400 | 401 | 404 | 503 = 401
  ) {
    super(message);
  }
}

export const authService = {
  async login(
    username: string,
    password: string,
    meta?: { ip?: string; userAgent?: string }
  ): Promise<{ token: string; expiresAt: string; user: AdminPublicUser; permissions: string[] }> {
    let user;
    try {
      user =
        (await adminUserRepository.findByUsername(username.trim().toLowerCase())) ??
        (await adminUserRepository.findByUsername(username.trim()));
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("admin_users") || msg.includes("schema cache") || e?.code === "42P01") {
        throw new AuthError(
          "Admin tables are missing. Run migrations/001_admin_system.sql in the Supabase SQL Editor.",
          503
        );
      }
      throw e;
    }

    if (!user || !user.is_active) {
      await logRepository.create({
        category: "admin_login_failed",
        action: "login_failed",
        actor_type: "admin",
        actor_name: username,
        metadata: { reason: "invalid_user" },
        ip_address: meta?.ip,
        user_agent: meta?.userAgent,
      });
      throw new AuthError("Invalid username or password", 401);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await logRepository.create({
        category: "admin_login_failed",
        action: "login_failed",
        actor_type: "admin",
        actor_id: user.id,
        actor_name: user.username,
        metadata: { reason: "bad_password" },
        ip_address: meta?.ip,
        user_agent: meta?.userAgent,
      });
      throw new AuthError("Invalid username or password", 401);
    }

    let token: string;
    let jti: string;
    let expiresAt: Date;
    try {
      ({ token, jti, expiresAt } = await signAdminToken({
        id: user.id,
        username: user.username,
        role: user.role,
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("ADMIN_JWT_SECRET")) {
        throw new AuthError(
          "Admin JWT is not configured on the server. Set ADMIN_JWT_SECRET (min 32 chars) and restart.",
          503
        );
      }
      throw e;
    }

    await adminUserRepository.update(user.id, { last_login_at: new Date().toISOString() });
    await logRepository.create({
      category: "admin_login",
      action: "login_success",
      actor_type: "admin",
      actor_id: user.id,
      actor_name: user.username,
      metadata: { jti },
      ip_address: meta?.ip,
      user_agent: meta?.userAgent,
    });

    const publicUser = toPublicAdminUser(user) as AdminPublicUser;
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: publicUser,
      permissions: permissionsForRole(user.role),
    };
  },

  async logout(token: string, meta?: { ip?: string; userAgent?: string }) {
    const payload = await verifyAdminToken(token);
    // Deny until original expiry (+ buffer)
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await tokenRepository.deny(payload.jti, payload.sub, expiresAt);
    await logRepository.create({
      category: "admin_activity",
      action: "logout",
      actor_type: "admin",
      actor_id: payload.sub,
      actor_name: payload.username,
      ip_address: meta?.ip,
      user_agent: meta?.userAgent,
    });
  },

  async me(adminId: string) {
    const user = await adminUserRepository.findById(adminId);
    if (!user || !user.is_active) throw new AuthError("Admin not found", 401);
    return {
      user: toPublicAdminUser(user) as AdminPublicUser,
      permissions: permissionsForRole(user.role),
    };
  },

  async changePassword(adminId: string, currentPassword: string, newPassword: string) {
    const user = await adminUserRepository.findById(adminId);
    if (!user) throw new AuthError("Admin not found", 404);
    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) throw new AuthError("Current password is incorrect", 400);
    const password_hash = await hashPassword(newPassword);
    await adminUserRepository.update(adminId, {
      password_hash,
      password_changed_at: new Date().toISOString(),
    });
    await logRepository.create({
      category: "admin_activity",
      action: "change_password",
      actor_type: "admin",
      actor_id: adminId,
      actor_name: user.username,
    });
  },

  async requestPasswordReset(username: string) {
    const user = await adminUserRepository.findByUsername(username.trim());
    // Always return the same message — never return a usable reset token to the client
    const publicMessage =
      "If the account exists, a password reset was initiated. Contact a super admin for the out-of-band token.";
    if (!user) {
      return { message: publicMessage };
    }
    const raw = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await tokenRepository.createResetToken(user.id, tokenHash, expiresAt);
    await logRepository.create({
      category: "admin_activity",
      action: "password_reset_requested",
      actor_type: "admin",
      actor_id: user.id,
      actor_name: user.username,
    });
    // Dev-only: token appears in server logs for local ops — never in API responses
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[admin] Password reset token for "${user.username}" (dev only, expires 1h): ${raw}`
      );
    } else {
      console.log(
        `[admin] Password reset token issued for "${user.username}" (deliver out-of-band; not returned in API)`
      );
    }
    return { message: publicMessage };
  },

  async confirmPasswordReset(token: string, newPassword: string) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = await tokenRepository.findValidReset(tokenHash);
    if (!row) throw new AuthError("Invalid or expired reset token", 400);
    const password_hash = await hashPassword(newPassword);
    await adminUserRepository.update(row.admin_user_id, {
      password_hash,
      password_changed_at: new Date().toISOString(),
    });
    await tokenRepository.markResetUsed(row.id);
    await logRepository.create({
      category: "admin_activity",
      action: "password_reset_completed",
      actor_type: "admin",
      actor_id: row.admin_user_id,
    });
  },
};
