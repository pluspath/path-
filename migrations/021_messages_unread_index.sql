-- Speeds unread DM aggregates: filter by conversation + exclude self sender + created_at.
CREATE INDEX IF NOT EXISTS idx_messages_conv_sender_created
  ON public.messages (conversation_id, sender_id, created_at DESC);
