-- Comment notification deep links: store the exact comment that triggered the notice.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS comment_id UUID;

CREATE INDEX IF NOT EXISTS idx_notifications_comment_id
  ON public.notifications (comment_id)
  WHERE comment_id IS NOT NULL;

-- Repair moments whose comment_count drifted because RLS blocked non-owner increments.
UPDATE public.posts p
SET comment_count = sub.cnt
FROM (
  SELECT post_id, COUNT(*)::int AS cnt
  FROM public.comments
  GROUP BY post_id
) sub
WHERE p.id = sub.post_id
  AND COALESCE(p.comment_count, 0) <> sub.cnt;

NOTIFY pgrst, 'reload schema';
