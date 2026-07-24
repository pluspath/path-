/**
 * Start API (:3000) + Admin production server (:3001) together.
 * Usage: bun run start:all
 * (Builds admin first via package.json script)
 */
const api = Bun.spawn(["bun", "run", "start"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

const admin = Bun.spawn(["bun", "run", "admin:start"], {
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
