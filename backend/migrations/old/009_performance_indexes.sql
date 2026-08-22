-- Performance indexes for messaging + moderation (idempotent).

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON public.messages (sender_id);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user
  ON public.conversation_participants (user_id);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conv
  ON public.conversation_participants (conversation_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker
  ON public.user_blocks (blocker_id);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON public.user_blocks (blocked_id);

CREATE INDEX IF NOT EXISTS idx_friendships_status_pair
  ON public.friendships (status, requester_id, receiver_id);
