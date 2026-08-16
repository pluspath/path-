# Path+ Admin Dashboard — VPS Deployment

## Prerequisites

- Bun installed on the VPS
- Node.js 20+ (optional; Bun can run Next.js)
- PM2 (`npm i -g pm2`)
- Nginx
- Supabase project already used by production

## 1. Database migration (REQUIRED before first admin login)

**Option A — Supabase SQL Editor (recommended)**

1. Open Supabase → SQL Editor  
2. Run `migrations/001_admin_system.sql`  
3. Run `migrations/002_user_preferences.sql` (privacy / notification prefs)  
4. (Optional) Run `migrations/000_exec_sql_helper.sql` if you want auto-migrate via RPC later  

**Option B — DATABASE_URL**

```bash
# Add DATABASE_URL to backend .env (from Supabase → Project Settings → Database)
bun run migrate:admin
```

This creates admin tables only and adds additive columns. Existing mobile tables are not recreated.

Then seed (if the SQL seed did not apply):

```bash
cd /path/to/backend
bun run seed:admin
```

Default credentials (change immediately after first login):

- Username: `admin`
- Password: `Admin@PathPlus2026!`

## 2. Environment variables

Backend `.env` must include existing production vars plus:

```env
ADMIN_JWT_SECRET=<openssl rand -hex 48>
ADMIN_JWT_EXPIRES_IN=8h
ADMIN_CORS_ORIGIN=http://admin.pathplus.store,https://admin.pathplus.store,http://localhost:3001,http://127.0.0.1:3001
BACKEND_URL=http://api.pathplus.store
```

Admin frontend `admin/.env.local` / production env:

```env
# Leave empty when using same VPS (recommended): browser calls /api/admin on :3001
# and Next.js proxies to the API on 127.0.0.1:3000.
# NEXT_PUBLIC_API_URL=

# Or point the browser at the public API domain:
NEXT_PUBLIC_API_URL=http://api.pathplus.store

NEXT_PUBLIC_APP_NAME=Path+ Admin
API_INTERNAL_URL=http://127.0.0.1:3000
```

If admin and API use **separate domains**, set the public API URL instead:

```env
NEXT_PUBLIC_API_URL=http://api.pathplus.store
ADMIN_CORS_ORIGIN=http://admin.pathplus.store,https://admin.pathplus.store
```

**Important:** `NEXT_PUBLIC_*` is baked in at `bun run build`. After changing it, rebuild the admin app.

## 3. Build

```bash
cd /path/to/backend
bun install
bun run typecheck

cd admin
bun install
# Do NOT set NEXT_PUBLIC_API_URL=http://localhost:3000 for a public VPS —
# that makes browsers call the visitor's own machine ("Failed to fetch").
bun run build
```

### Quick fix if login shows "Failed to fetch"

You are almost certainly opening `http://YOUR_VPS_IP:3001` while the UI still points at `localhost:3000`.

```bash
cd /path/to/backend/admin
# Ensure no NEXT_PUBLIC_API_URL=http://localhost:3000 in .env / .env.local
rm -f .env.local   # only if it forces localhost
echo 'API_INTERNAL_URL=http://127.0.0.1:3000' > .env.local
bun run build
cd ..
pm2 restart ecosystem.config.cjs
```

Then open `http://YOUR_VPS_IP:3001` and log in again.

Verify the API itself (from the VPS):

```bash
curl -X POST "http://127.0.0.1:3000/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@PathPlus2026!"}'
```

And via the admin proxy:

```bash
curl -X POST "http://127.0.0.1:3001/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@PathPlus2026!"}'
```

## 4. Start with PM2 (keeps running continuously)

PM2 auto-restarts on crash and can start again after a server reboot.

```bash
cd /path/to/backend
bash deploy/pm2-setup.sh
```

Or manually:

```bash
cd /path/to/backend
bun run admin:build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup          # copy/run the command it prints (once)
pm2 status
```

Processes:

- `pathplus-api` → port **3000** → http://api.pathplus.store
- `pathplus-admin` → port **3001** → http://admin.pathplus.store

After code or `.env` changes:

```bash
pm2 restart all --update-env
pm2 save
```

Check they stay up:

```bash
pm2 status
pm2 logs --lines 50
```

## 5. Nginx

Use `deploy/nginx.pathplus.conf` as a template.

Point:

- `api.pathplus.store` → `127.0.0.1:3000`
- `admin.pathplus.store` → `127.0.0.1:3001`

Enable TLS with Certbot.

Update `ADMIN_CORS_ORIGIN` and `NEXT_PUBLIC_API_URL` accordingly, then restart:

```bash
pm2 restart pathplus-api pathplus-admin
```

## 6. Verify mobile compatibility

Existing endpoints must still work:

```bash
curl "$BACKEND_URL/health"
curl "$BACKEND_URL/health/supabase"
# Mobile-auth routes unchanged under /api/auth, /api/posts, /api/friends, etc.
```

Admin:

```bash
curl -X POST "$BACKEND_URL/api/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@PathPlus2026!"}'
```

## 7. Security checklist

- [ ] `ADMIN_JWT_SECRET` is unique and long
- [ ] Default admin password rotated
- [ ] Admin panel not publicly indexed (optional Basic Auth / IP allowlist)
- [ ] HTTPS enabled
- [ ] Service role key never exposed to the admin frontend
- [ ] Migrations applied in production Supabase
