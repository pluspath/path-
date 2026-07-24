import { adminUserRepository } from "../repositories/admin-user.repository";
import { logRepository } from "../repositories/log.repository";
import { hashPassword } from "../utils/password";
import { permissionsForRole, toPublicAdminUser } from "../utils/permissions";
import { PERMISSIONS, type AdminRole } from "../constants";
import type { AdminPublicUser } from "../types";

type Actor = { id: string; name: string };

export const adminsService = {
  async list() {
    const users = await adminUserRepository.list();
    return users.map((u) => ({
      ...(toPublicAdminUser(u) as AdminPublicUser),
      permissions: permissionsForRole(u.role),
    }));
  },

  async create(
    input: {
      username: string;
      password: string;
      role: AdminRole;
      display_name?: string;
      email?: string;
    },
    actor: Actor
  ) {
    const password_hash = await hashPassword(input.password);
    const created = await adminUserRepository.create({
      username: input.username.toLowerCase(),
      password_hash,
      role: input.role,
      display_name: input.display_name,
      email: input.email,
    });
    await logRepository.create({
      category: "admin_activity",
      action: "admin_create",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "admin_user",
      target_id: created.id,
    });
    return toPublicAdminUser(created) as AdminPublicUser;
  },

  async update(
    id: string,
    patch: {
      role?: AdminRole;
      display_name?: string | null;
      email?: string | null;
      is_active?: boolean;
      password?: string;
    },
    actor: Actor
  ) {
    const data: Record<string, unknown> = {};
    if (patch.role !== undefined) data.role = patch.role;
    if (patch.display_name !== undefined) data.display_name = patch.display_name;
    if (patch.email !== undefined) data.email = patch.email;
    if (patch.is_active !== undefined) data.is_active = patch.is_active;
    if (patch.password) {
      data.password_hash = await hashPassword(patch.password);
      data.password_changed_at = new Date().toISOString();
    }
    const updated = await adminUserRepository.update(id, data as any);
    await logRepository.create({
      category: "admin_activity",
      action: "admin_update",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "admin_user",
      target_id: id,
    });
    return toPublicAdminUser(updated) as AdminPublicUser;
  },

  async delete(id: string, actor: Actor) {
    if (id === actor.id) throw new Error("Cannot delete your own account");
    await adminUserRepository.delete(id);
    await logRepository.create({
      category: "admin_activity",
      action: "admin_delete",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "admin_user",
      target_id: id,
    });
  },

  rolesMatrix() {
    return PERMISSIONS;
  },
};
