-- Profile privacy, language, and account-deletion requests
-- Run in Supabase SQL Editor after deploying the new backend.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_friends_to_friends BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_friends_to_others BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_posts_to_friends BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_posts_to_others BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_moments_to_friends BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_moments_to_others BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'done', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  admin_note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_pending_user
  ON public.account_deletion_requests (user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_account_deletion_status
  ON public.account_deletion_requests (status, created_at DESC);
