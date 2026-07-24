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
API expected at: `NEXT_PUBLIC_API_URL` (default http://localhost:3000)

## Production

```bash
bun run build
bun run start
```

Or via PM2 from the backend root using `ecosystem.config.cjs`.

See `../docs/DEPLOYMENT.md` for VPS instructions.
