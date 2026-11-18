-- One Repath relationship per (user, original moment).
-- Safe / idempotent: remove duplicate rows first, then add a partial unique index.
-- Does not delete original Moments or unrelated posts.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, repath_of
           ORDER BY created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.posts
  WHERE repath_of IS NOT NULL
)
DELETE FROM public.posts p
USING ranked r
WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_user_repath_unique
  ON public.posts (user_id, repath_of)
  WHERE repath_of IS NOT NULL;
