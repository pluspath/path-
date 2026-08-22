-- =====================================================
-- Core RLS policies for mobile auth (Supabase JWT)
-- Idempotent: safe to re-run.
-- Ensures authenticated users can create/edit/delete their
-- own posts while preserving row-level security.
-- =====================================================

-- Enable RLS on all application tables
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;

-- ---------- Profiles ----------
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Anyone can view profiles"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ---------- Posts ----------
DROP POLICY IF EXISTS "Anyone can view posts" ON public.posts;
DROP POLICY IF EXISTS "Users can create posts" ON public.posts;
DROP POLICY IF EXISTS "Users can update own posts" ON public.posts;
DROP POLICY IF EXISTS "Users can delete own posts" ON public.posts;

CREATE POLICY "Anyone can view posts"
  ON public.posts FOR SELECT
  USING (true);

CREATE POLICY "Users can create posts"
  ON public.posts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own posts"
  ON public.posts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own posts"
  ON public.posts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------- Reactions ----------
DROP POLICY IF EXISTS "Anyone can view reactions" ON public.reactions;
DROP POLICY IF EXISTS "Users can add reactions" ON public.reactions;
DROP POLICY IF EXISTS "Users can remove own reactions" ON public.reactions;

CREATE POLICY "Anyone can view reactions"
  ON public.reactions FOR SELECT
  USING (true);

CREATE POLICY "Users can add reactions"
  ON public.reactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove own reactions"
  ON public.reactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------- Comments ----------
DROP POLICY IF EXISTS "Anyone can view comments" ON public.comments;
DROP POLICY IF EXISTS "Users can add comments" ON public.comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;

CREATE POLICY "Anyone can view comments"
  ON public.comments FOR SELECT
  USING (true);

CREATE POLICY "Users can add comments"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments"
  ON public.comments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------- Friendships ----------
DROP POLICY IF EXISTS "Users can view their own friendships" ON public.friendships;
DROP POLICY IF EXISTS "Users can create friendship requests" ON public.friendships;
DROP POLICY IF EXISTS "Users can update friendships involving them" ON public.friendships;
DROP POLICY IF EXISTS "Users can delete their own friendships" ON public.friendships;

CREATE POLICY "Users can view their own friendships"
  ON public.friendships FOR SELECT
  TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can create friendship requests"
  ON public.friendships FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Users can update friendships involving them"
  ON public.friendships FOR UPDATE
  TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = requester_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can delete their own friendships"
  ON public.friendships FOR DELETE
  TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = receiver_id);

-- ---------- Notifications ----------
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Anyone can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Authenticated users may create notifications (friend sleep alerts, etc.)
CREATE POLICY "Anyone can create notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------- Conversations ----------
DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;

CREATE POLICY "Participants can view conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Participants can update conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = id AND user_id = auth.uid()
    )
  );

-- ---------- Conversation participants ----------
DROP POLICY IF EXISTS "Participants can view participants" ON public.conversation_participants;
DROP POLICY IF EXISTS "Users can join conversations" ON public.conversation_participants;

CREATE POLICY "Participants can view participants"
  ON public.conversation_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp2
      WHERE cp2.conversation_id = conversation_id AND cp2.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join conversations"
  ON public.conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ---------- Messages ----------
DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;
DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;

CREATE POLICY "Participants can view messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
  );
