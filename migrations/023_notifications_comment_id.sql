-- Comment notification deep links: store the exact comment that triggered the notice.
-- Additive only — safe to re-run.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS comment_id UUID;

CREATE INDEX IF NOT EXISTS idx_notifications_comment_id
  ON public.notifications (comment_id)
  WHERE comment_id IS NOT NULL;

-- Optional: allow mentions rows to point at a comment when the table exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mentions'
  ) THEN
    ALTER TABLE public.mentions
      ADD COLUMN IF NOT EXISTS comment_id UUID;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
