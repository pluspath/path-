-- Repair denormalized posts.comment_count from live comments.
-- Safe: only updates rows whose stored count disagrees with COUNT(comments).
-- Does not delete or modify comment rows.

UPDATE public.posts AS p
SET comment_count = sub.cnt
FROM (
  SELECT post_id, COUNT(*)::int AS cnt
  FROM public.comments
  GROUP BY post_id
) AS sub
WHERE p.id = sub.post_id
  AND COALESCE(p.comment_count, 0) <> sub.cnt;

-- Moments with zero comments in the table should report 0 (not a stale positive).
UPDATE public.posts AS p
SET comment_count = 0
WHERE COALESCE(p.comment_count, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.comments c WHERE c.post_id = p.id
  );

CREATE INDEX IF NOT EXISTS idx_comments_post_id_created_at_desc
  ON public.comments (post_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
