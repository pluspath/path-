-- Audience + disable-comments on posts
-- Run in Supabase SQL Editor, then restart pathplus-api.
-- Without this column, "Disable Comments" is silently ignored on create/edit.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS audience TEXT NULL DEFAULT 'friends';

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS comments_disabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Optional: constrain audience values (skip if you already have a check constraint)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_audience_check'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_audience_check
      CHECK (audience IS NULL OR audience IN ('public', 'friends', 'close', 'private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_comments_disabled
  ON public.posts (comments_disabled)
  WHERE comments_disabled = TRUE;
