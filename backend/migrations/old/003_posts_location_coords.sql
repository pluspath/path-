-- Add GPS coordinates to posts (used by create-moment location statuses).
-- Additive only — safe to re-run.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;
