-- User privacy + notification preferences (additive)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS post_visibility TEXT NOT NULL DEFAULT 'friends'
    CHECK (post_visibility IN ('everyone', 'friends')),
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE;
