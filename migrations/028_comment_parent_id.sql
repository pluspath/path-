-- Nested comment replies: nullable parent pointing at another comment on the same Moment.
-- SET NULL (not CASCADE) so deleting one comment does not wipe its whole reply tree.
-- Backward compatible: existing comments remain top-level (parent_comment_id IS NULL).

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_comment_id UUID
  REFERENCES public.comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON public.comments (parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comments_post_parent_created
  ON public.comments (post_id, parent_comment_id, created_at ASC);
