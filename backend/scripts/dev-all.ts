/**
 * Start API (:3000) + Admin Dashboard (:3001) together.
 * Usage: bun run dev:all
 */
const api = Bun.spawn(["bun", "run", "dev"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const admin = Bun.spawn(["bun", "run", "admin:dev"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

function shutdown() {
  api.kill();
  admin.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const [apiCode, adminCode] = await Promise.all([api.exited, admin.exited]);
process.exit(apiCode || adminCode || 0);
