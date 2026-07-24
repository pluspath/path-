# Path+ Admin API

Base URL: `{BACKEND_URL}/api/admin`

All protected routes require:

```
Authorization: Bearer <admin_jwt>
```

Admin auth is **independent** of Supabase Auth used by the mobile app.

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | `{ username, password }` → `{ token, expiresAt, user, permissions }` |
| POST | `/auth/logout` | Yes | Revoke current JWT |
| GET | `/auth/me` | Yes | Current admin + permissions |
| POST | `/auth/change-password` | Yes | `{ currentPassword, newPassword }` |
| POST | `/auth/reset-password/request` | No | `{ username }` → may include one-time `resetToken` |
| POST | `/auth/reset-password/confirm` | No | `{ token, newPassword }` |

## Dashboard

| Method | Path | Permission |
|--------|------|------------|
| GET | `/dashboard` | `dashboard:read` |

## Users (profiles + Supabase Auth)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/users` | `users:read` |
| GET | `/users/export` | `users:read` |
| GET | `/users/:id` | `users:read` |
| GET | `/users/:id/activity` | `users:read` |
| PATCH | `/users/:id` | `users:write` |
| POST | `/users/:id/suspend` | `users:suspend` |
| POST | `/users/:id/activate` | `users:suspend` |
| POST | `/users/:id/reset-password` | `users:write` |
| POST | `/users/:id/verify-email` | `users:write` |
| DELETE | `/users/:id` | `users:delete` |

## Posts (Moments)

| Method | Path | Permission |
|--------|------|------------|
| GET/POST | `/posts` | read/write |
| GET/PATCH/DELETE | `/posts/:id` | read/write/delete |
| POST | `/posts/:id/hide` | write |
| POST | `/posts/:id/publish` | write |
| POST | `/posts/:id/unpublish` | write |

## Comments

| Method | Path | Permission |
|--------|------|------------|
| GET | `/comments` | read |
| PATCH | `/comments/:id` | write |
| POST | `/comments/:id/approve` | write |
| POST | `/comments/:id/reject` | write |
| POST | `/comments/:id/reply` | write |
| POST | `/comments/:id/report` | write |
| DELETE | `/comments/:id` | delete |

## Friendships

| Method | Path | Permission |
|--------|------|------------|
| GET | `/friendships` | read |
| GET | `/friendships/export` | read |
| POST | `/friendships/:id/confirm` | write |
| POST | `/friendships/:id/cancel` | write |
| PATCH | `/friendships/:id` | write |

## Notifications

| Method | Path | Permission |
|--------|------|------------|
| GET | `/notifications` | read |
| POST | `/notifications/send` | send |

## Reports / CMS / Settings / Files / Logs / Admins / Health

See route modules under `src/admin/routes/`.

## Response shape

Success:
```json
{ "data": {} }
```

Paginated:
```json
{ "data": [], "meta": { "total": 0, "page": 1, "limit": 20, "totalPages": 1 } }
```

Error:
```json
{ "error": { "message": "..." } }
```
