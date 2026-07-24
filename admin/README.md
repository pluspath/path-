# Path+ Admin Dashboard

Next.js admin console for the Path+ Hono API.

## Development

```bash
# from backend/
bun install
cd admin
bun install
cp .env.local.example .env.local
bun run dev
```

Dashboard: http://localhost:3001  
API:

- Default: same-origin `/api/admin` (Next.js proxies to `API_INTERNAL_URL`, default `http://127.0.0.1:3000`)
- Optional cross-origin: set `NEXT_PUBLIC_API_URL` to the public API base (rebuild required)

## Production

```bash
bun run build
bun run start
```

Or via PM2 from the backend root using `ecosystem.config.cjs`.

See `../docs/DEPLOYMENT.md` for VPS instructions.
