-- Email verification pending registrations + password reset OTP storage
-- Run in Supabase SQL Editor if boot-time exec_sql is unavailable.

CREATE TABLE IF NOT EXISTS public.pending_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_encrypted TEXT NOT NULL,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT,
  birthday TEXT,
  otp_hash TEXT NOT NULL,
  otp_expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_username_lower
  ON public.pending_registrations (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_pending_registrations_expires
  ON public.pending_registrations (expires_at);

ALTER TABLE public.pending_registrations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  email TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  otp_hash TEXT NOT NULL,
  otp_expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expires
  ON public.password_reset_otps (otp_expires_at);

ALTER TABLE public.password_reset_otps ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
