/**
 * PM2 process file for Path+ API + Admin Dashboard on the same VPS.
 *
 * First-time setup (on the VPS):
 *   bun run admin:build
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup    # run the command it prints (enables boot on reboot)
 *
 * Later:
 *   pm2 restart ecosystem.config.cjs --update-env
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: "pathplus-api",
      cwd: __dirname,
      script: "src/index.ts",
      interpreter: "bun",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      min_uptime: "10s",
      max_restarts: 50,
      exp_backoff_restart_delay: 200,
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      time: true,
    },
    {
      name: "pathplus-admin",
      cwd: `${__dirname}/admin`,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3001 -H 0.0.0.0",
      interpreter: "bun",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      min_uptime: "10s",
      max_restarts: 50,
      exp_backoff_restart_delay: 200,
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        // Browser uses NEXT_PUBLIC_API_URL=https://api.pathplus.store (admin/.env.local at build time)
        API_INTERNAL_URL: "http://127.0.0.1:3000",
      },
      time: true,
    },
  ],
};
