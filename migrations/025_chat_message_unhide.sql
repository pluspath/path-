-- 025_chat_message_unhide.sql
-- When a message is inserted, atomically bump the conversation's updated_at and
-- bring the chat back for every participant who "deleted" it (hidden_at set).
-- Additive and idempotent: safe to re-run.

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.messages_after_insert_unhide()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
     SET updated_at = NEW.created_at
   WHERE id = NEW.conversation_id;

  UPDATE public.conversation_participants
     SET hidden_at = NULL
   WHERE conversation_id = NEW.conversation_id
     AND hidden_at IS NOT NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_after_insert_unhide ON public.messages;

CREATE TRIGGER trg_messages_after_insert_unhide
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_after_insert_unhide();
