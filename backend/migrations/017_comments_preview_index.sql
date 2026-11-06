-- Feed comment previews: the feed fetches the newest comments for a whole page
-- of moments with one query (post_id IN (...) ORDER BY created_at DESC).
CREATE INDEX IF NOT EXISTS idx_comments_post_id_created_at_desc
  ON public.comments (post_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
