-- Lightweight live presence for authenticated mobile app users.
-- One row per user; heartbeat upserts last_seen_at. Admin counts unique users
-- with a recent heartbeat (see presence window in application code).

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client TEXT NOT NULL DEFAULT 'mobile',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen
  ON public.user_presence (last_seen_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_presence'
      AND policyname = 'user_presence_select_own'
  ) THEN
    CREATE POLICY user_presence_select_own
      ON public.user_presence
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;
