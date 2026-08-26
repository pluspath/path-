# Path+ Authentication & Email Configuration

Password reset and signup verification use **6-digit OTP codes sent by Resend**.
They do **not** rely on Supabase “magic link” / recovery URLs in user-facing emails.
This avoids `localhost` links in production reset emails.

## Provider

| Flow | Provider | Notes |
|------|----------|--------|
| Signup verification OTP | **Resend** | `POST /api/auth/signup`, `/resend-otp` |
| Password reset OTP | **Resend** | `POST /api/auth/forgot-password`, `/resend-reset-otp` |
| Session after OTP | Supabase Admin `generateLink` + `verifyOtp` | Server-side only; **not emailed** |
| Account password storage | Supabase Auth | Updated via service role after reset OTP |

## Required environment variables (backend)

Set these on the production host (never commit real values):

| Variable | Purpose |
|----------|---------|
| `BACKEND_URL` | Public API URL, e.g. `https://api.pathplus.store` |
| `PUBLIC_APP_URL` | Public site shown in emails, e.g. `https://site.pathplus.store` (**not** localhost) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Anon key (server + mobile) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (backend only — never in the mobile app) |
| `RESEND_API_KEY` | Resend API key for OTP emails |
| `RESEND_FROM_EMAIL` | Optional. Default `Path+ <noreply@pathplus.store>` |

## Resend setup

1. Create a Resend account and API key.
2. Verify the sending domain `pathplus.store` (or your domain) in Resend → Domains.
3. Set `RESEND_API_KEY` and optionally `RESEND_FROM_EMAIL` on the backend.
4. Confirm test emails deliver to a real inbox (not only logs).

## Supabase Dashboard settings (recommended)

Even though user-facing reset emails are OTP-only, configure Supabase so any
dashboard-triggered or legacy Auth emails never point at localhost:

### Authentication → URL Configuration

| Setting | Production value |
|---------|------------------|
| **Site URL** | `https://site.pathplus.store` |
| **Redirect URLs** | `https://site.pathplus.store/**` |
| | `https://api.pathplus.store/**` |
| | `vibecode://**` (Expo app scheme from `app.json`) |

Do **not** leave Site URL as `http://localhost:3000` in the production project.

### Authentication → Email

- Prefer custom SMTP / disable unused Supabase recovery templates if you only use Path+ OTP flows.
- If Supabase still sends Auth emails, their links use **Site URL** above.

## Mobile deep linking

| Item | Value |
|------|--------|
| Expo scheme | `vibecode` (`app.json` → `expo.scheme`) |
| Backend URL (EAS) | `EXPO_PUBLIC_BACKEND_URL=https://api.pathplus.store` |

Password reset does not open a browser link: the user stays in the app
(Forgot Password → OTP → Set New Password).

## Gender & date of birth (Apple 5.1.1(v))

- **Not required** to create an account (frontend + backend + database).
- Columns `profiles.gender` and `profiles.birthday` are nullable.
- If birthday is provided, the user must be 18+.

## Smoke tests

```bash
# Signup without gender/birthday
curl -sS -X POST "$BACKEND_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Secret1","username":"you_user","fullName":"You"}'

# Forgot password (OTP email — no localhost URL)
curl -sS -X POST "$BACKEND_URL/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```
