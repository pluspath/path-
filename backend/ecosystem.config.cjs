/**
 * PM2 process file for Path+ API + Admin Dashboard on the same VPS.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
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
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      max_memory_restart: "512M",
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
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        // Browser uses NEXT_PUBLIC_API_URL=http://api.pathplus.store (set in admin/.env.local at build time)
        API_INTERNAL_URL: "http://127.0.0.1:3000",
      },
      max_memory_restart: "512M",
      time: true,
    },
  ],
};
