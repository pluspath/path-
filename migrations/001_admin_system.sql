-- Path+ Admin System Migration
-- Additive only — does not drop or recreate existing tables.
-- Run against Supabase Postgres (SQL Editor or psql).

-- ---------------------------------------------------------------------------
-- Soft columns on existing tables (defaults preserve mobile behavior)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS admin_reply TEXT,
  ADD COLUMN IF NOT EXISTS reported_count INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Admin users (independent of Supabase Auth / mobile)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'moderator')),
  display_name TEXT,
  email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON public.admin_users (username);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON public.admin_users (role);

-- ---------------------------------------------------------------------------
-- Admin JWT denylist (logout / revoke)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_token_denylist (
  jti TEXT PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_token_denylist_expires ON public.admin_token_denylist (expires_at);

-- ---------------------------------------------------------------------------
-- Password reset tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- App settings (key/value JSON)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_settings (key, value) VALUES
  ('general', '{"appName":"Path+","logoUrl":"","splashUrl":"","maintenanceMode":false,"contactEmail":"","contactPhone":"","social":{"twitter":"","instagram":"","facebook":"","website":""}}'::jsonb),
  ('push', '{"expoEnabled":true,"notes":""}'::jsonb),
  ('safe_env', '{"publicApiBaseUrl":"","supportEmail":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- CMS content
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_content (slug, title, body) VALUES
  ('about', 'About', 'About Path+'),
  ('terms', 'Terms of Service', 'Terms of Service'),
  ('privacy', 'Privacy Policy', 'Privacy Policy'),
  ('faq', 'FAQ', 'Frequently Asked Questions'),
  ('help', 'Help Center', 'Help Center')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Content reports / moderation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'user', 'message', 'other')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution_note TEXT,
  resolved_by UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports (status);
CREATE INDEX IF NOT EXISTS idx_reports_target ON public.reports (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Audit / activity logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN (
    'admin_login', 'admin_login_failed', 'admin_activity',
    'user_activity', 'api_error', 'unhandled_exception', 'system'
  )),
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  actor_name TEXT,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_category ON public.admin_logs (category);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_actor ON public.admin_logs (actor_type, actor_id);

-- ---------------------------------------------------------------------------
-- Seed default Super Admin (password hash only — never plaintext)
-- Username: admin
-- Password: set via scripts/seed-admin.ts if this hash is rotated
-- ---------------------------------------------------------------------------
INSERT INTO public.admin_users (username, password_hash, role, display_name, email)
VALUES (
  'admin',
  '$2b$12$fpAhYXrPh0lwdEBYBfohIe4fSOI2P.VA2VaNtPeNE26lHOry9pnx.',
  'super_admin',
  'Path+ Administrator',
  'admin@pathplus.app'
)
ON CONFLICT (username) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS: service role bypasses RLS; lock down public access to admin tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_token_denylist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

-- No public policies → only service_role / postgres can access admin tables.
