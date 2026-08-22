-- Path+ hotfix for favorites / blocks / reports (run in Supabase SQL Editor once).
-- Backend path: C:\Users\admin\Downloads\new\path-plus-main\path-plus-main\backend

CREATE TABLE IF NOT EXISTS public.close_friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.close_friends ADD COLUMN IF NOT EXISTS owner_id UUID;
UPDATE public.close_friends SET owner_id = user_id WHERE owner_id IS NULL AND user_id IS NOT NULL;
UPDATE public.close_friends SET user_id = owner_id WHERE user_id IS NULL AND owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_close_friends_user ON public.close_friends (user_id);
CREATE INDEX IF NOT EXISTS idx_close_friends_owner ON public.close_friends (owner_id);
ALTER TABLE public.close_friends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own close friends" ON public.close_friends;
DROP POLICY IF EXISTS "Users add close friends" ON public.close_friends;
DROP POLICY IF EXISTS "Users remove close friends" ON public.close_friends;
CREATE POLICY "Users view own close friends" ON public.close_friends
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR auth.uid() = owner_id);
CREATE POLICY "Users add close friends" ON public.close_friends
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR auth.uid() = owner_id);
CREATE POLICY "Users remove close friends" ON public.close_friends
  FOR DELETE TO authenticated USING (auth.uid() = user_id OR auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON public.user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks (blocked_id);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own blocks" ON public.user_blocks;
DROP POLICY IF EXISTS "Users can create own blocks" ON public.user_blocks;
DROP POLICY IF EXISTS "Users can delete own blocks" ON public.user_blocks;
DROP POLICY IF EXISTS "Users can view blocks involving them" ON public.user_blocks;
CREATE POLICY "Users can view own blocks" ON public.user_blocks
  FOR SELECT TO authenticated USING (auth.uid() = blocker_id);
CREATE POLICY "Users can create own blocks" ON public.user_blocks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY "Users can delete own blocks" ON public.user_blocks
  FOR DELETE TO authenticated USING (auth.uid() = blocker_id);
CREATE POLICY "Users can view blocks involving them" ON public.user_blocks
  FOR SELECT TO authenticated USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_type TEXT,
  target_id UUID,
  reason TEXT,
  details TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reporter_user_id UUID;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS target_id UUID;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reporter_id UUID;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reported_user_id UUID;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reported_post_id UUID;
