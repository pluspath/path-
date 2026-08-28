-- Push notification device registry (multiple devices per user).
-- Run in Supabase SQL Editor if boot-time exec_sql is unavailable.

CREATE TABLE IF NOT EXISTS public.user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  push_token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'unknown',
  device_id TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id),
  UNIQUE (push_token)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_active
  ON public.user_devices (user_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_devices_push_token
  ON public.user_devices (push_token);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- Users may read/update only their own device rows (service role bypasses RLS).
DROP POLICY IF EXISTS "Users view own devices" ON public.user_devices;
CREATE POLICY "Users view own devices"
  ON public.user_devices FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own devices" ON public.user_devices;
CREATE POLICY "Users manage own devices"
  ON public.user_devices FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
