# External Services Configuration

Admin Dashboard → **Settings → External Services** manages integrations for Path+.

## Architecture

```
Admin Dashboard
      ↓  JWT + settings:write
Secure Admin API  (/api/admin/external-services)
      ↓
Configuration Service  (DB encrypted secrets → env fallback)
      ↓
Email / Places / Push / Supabase clients
```

Mobile never receives server secrets.

## Services

| Service | Admin configurable | Remains in env | Notes |
|---------|-------------------|----------------|-------|
| **Email (Resend)** | API key (encrypted), from, reply-to, publicAppUrl (allowlisted), template subjects, enable | `RESEND_API_KEY` fallback, `CONFIG_ENCRYPTION_KEY` | OTP-only auth emails (no reset links) |
| **Supabase** | Enable flag + connection test | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Service role never accepted or returned via Admin API |
| **Push (Expo)** | Enable / notes | — | No Expo server secret for basic send |
| **Google Places** | API key (encrypted), enable | `GOOGLE_PLACES_API_KEY` fallback | Server Places Nearby only |

## Required server env

```bash
# Always required
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_JWT_SECRET=

# Strongly recommended
RESEND_API_KEY=
RESEND_FROM_EMAIL=onboarding@resend.dev
PUBLIC_APP_URL=https://site.pathplus.store
GOOGLE_PLACES_API_KEY=

# Required to store secrets via Admin Dashboard
CONFIG_ENCRYPTION_KEY=$(openssl rand -hex 32)
```

## Database migration

Run in Supabase SQL Editor:

1. `migrations/001_admin_system.sql` (if not already applied)
2. `migrations/002_external_services.sql`

Or rely on boot `exec_sql` when the RPC exists.

## API (admin JWT required)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/admin/external-services` | `settings:read` |
| GET | `/api/admin/external-services/:service` | `settings:read` |
| PATCH | `/api/admin/external-services/:service` | `settings:write` (super_admin) |
| POST | `/api/admin/external-services/:service/test` | `settings:write` |
| POST | `/api/admin/external-services/email/send-test` | `settings:write` |

Responses never include secret values — only `Configured ✓` / presence flags.

High-risk updates (replace key, disable service) require `confirmHighRisk: true`.

## Password reset

Mobile password reset uses **OTP codes via Resend**, not Supabase recovery links.
Emails never contain `localhost` recovery URLs. Footer branding uses `PUBLIC_APP_URL`
or Admin `publicAppUrl` (trusted host allowlist only).

## Security

- Secrets encrypted with AES-256-GCM (`CONFIG_ENCRYPTION_KEY`)
- RLS on `external_service_settings` with no public policies
- Admin RBAC enforced on every route
- Audit log actions without secret values
- Test Connection uses fixed provider endpoints (no SSRF)
- Test email rate-limited (5/hour/admin)
- Open redirect prevented via publicAppUrl allowlist
