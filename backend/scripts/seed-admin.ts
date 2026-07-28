/**
 * Ensures the default Super Admin exists.
 * Usage: ADMIN_DEFAULT_PASSWORD='...' bun run scripts/seed-admin.ts
 *
 * Password must come from ADMIN_DEFAULT_PASSWORD (min 12 chars).
 * Only the bcrypt hash is stored in the database.
 */
import { hashPassword } from "../src/admin/utils/password";
import { adminUserRepository } from "../src/admin/repositories/admin-user.repository";

const username = "admin";
const password = process.env.ADMIN_DEFAULT_PASSWORD;

if (!password || password.length < 12) {
  console.error(
    "[seed-admin] Set ADMIN_DEFAULT_PASSWORD (min 12 characters) before seeding."
  );
  process.exit(1);
}

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
