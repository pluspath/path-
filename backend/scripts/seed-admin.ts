/**
 * Ensures the default Super Admin exists.
 * Usage: bun run scripts/seed-admin.ts
 *
 * Password is read from ADMIN_DEFAULT_PASSWORD or the known default.
 * Only the bcrypt hash is stored in the database.
 */
import { hashPassword } from "../src/admin/utils/password";
import { adminUserRepository } from "../src/admin/repositories/admin-user.repository";

const username = "admin";
const password = process.env.ADMIN_DEFAULT_PASSWORD || "Admin@PathPlus2026!";

const hash = await hashPassword(password);
const existing = await adminUserRepository.findByUsername(username);

if (existing) {
  console.log(`[seed-admin] User "${username}" already exists (id=${existing.id}, role=${existing.role})`);
  process.exit(0);
}

const created = await adminUserRepository.create({
  username,
  password_hash: hash,
  role: "super_admin",
  display_name: "Path+ Administrator",
  email: "admin@pathplus.app",
});

console.log(`[seed-admin] Created super_admin "${created.username}" (${created.id})`);
