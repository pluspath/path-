-- 025_chat_message_unhide.sql
-- SUPERSEDED by 026_per_user_chat_deletion_boundary.sql.
--
-- Historical note: the original 025 version cleared hidden_at for all
-- participants on INSERT, which restored deleted-for-me history. Do not
-- re-introduce that behavior. This file is kept for migration history and
-- now only ensures the hidden_at column exists. Apply 026 after this.

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_hidden
  ON public.conversation_participants (user_id, hidden_at);
