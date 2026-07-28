-- Social features: blocks, saved posts, hashtags, mentions, shares
-- Additive migration — safe to re-run (IF NOT EXISTS).

-- ---------------------------------------------------------------------------
-- User blocks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON public.user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks (blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own blocks" ON public.user_blocks;
CREATE POLICY "Users can view own blocks" ON public.user_blocks
  FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can create own blocks" ON public.user_blocks;
CREATE POLICY "Users can create own blocks" ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can delete own blocks" ON public.user_blocks;
CREATE POLICY "Users can delete own blocks" ON public.user_blocks
  FOR DELETE TO authenticated
  USING (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- Saved / bookmarked posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON public.saved_posts (user_id, created_at DESC);

ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own saved posts" ON public.saved_posts;
CREATE POLICY "Users can view own saved posts" ON public.saved_posts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can save posts" ON public.saved_posts;
CREATE POLICY "Users can save posts" ON public.saved_posts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unsave posts" ON public.saved_posts;
CREATE POLICY "Users can unsave posts" ON public.saved_posts
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Hashtags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag TEXT NOT NULL UNIQUE,
  post_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hashtags_tag ON public.hashtags (tag);
CREATE INDEX IF NOT EXISTS idx_hashtags_count ON public.hashtags (post_count DESC);

CREATE TABLE IF NOT EXISTS public.post_hashtags (
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  hashtag_id UUID NOT NULL REFERENCES public.hashtags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, hashtag_id)
);

CREATE INDEX IF NOT EXISTS idx_post_hashtags_hashtag ON public.post_hashtags (hashtag_id);

ALTER TABLE public.hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_hashtags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone authenticated can read hashtags" ON public.hashtags;
CREATE POLICY "Anyone authenticated can read hashtags" ON public.hashtags
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone authenticated can read post_hashtags" ON public.post_hashtags;
CREATE POLICY "Anyone authenticated can read post_hashtags" ON public.post_hashtags
  FOR SELECT TO authenticated USING (true);

-- Writes go through service role from API

-- ---------------------------------------------------------------------------
-- Mentions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mentioned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_mentions_user ON public.mentions (mentioned_user_id, created_at DESC);

ALTER TABLE public.mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read mentions involving them" ON public.mentions;
CREATE POLICY "Users can read mentions involving them" ON public.mentions
  FOR SELECT TO authenticated
  USING (auth.uid() = mentioned_user_id OR auth.uid() = mentioned_by);

-- ---------------------------------------------------------------------------
-- Post shares (in-app share count / activity)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'in_app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_shares_post ON public.post_shares (post_id);

ALTER TABLE public.post_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create shares" ON public.post_shares;
CREATE POLICY "Users can create shares" ON public.post_shares
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read shares" ON public.post_shares;
CREATE POLICY "Users can read shares" ON public.post_shares
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Allow users to insert their own reports (mobile reporting)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create reports" ON public.reports;
CREATE POLICY "Users can create reports" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_user_id);

DROP POLICY IF EXISTS "Users can view own reports" ON public.reports;
CREATE POLICY "Users can view own reports" ON public.reports
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_user_id);

-- ---------------------------------------------------------------------------
-- Friendship blocked status already exists in admin schema; ensure check allows it
-- ---------------------------------------------------------------------------
-- No schema change needed if status is free text; friendships already support blocked via admin.
