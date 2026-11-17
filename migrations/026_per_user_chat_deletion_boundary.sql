-- 026_per_user_chat_deletion_boundary.sql
-- Fix: conversation deletion must stay private to the deleting participant.
--
-- Migration 025 installed trg_messages_after_insert_unhide which CLEARED
-- hidden_at for ALL participants on every new message. That restored the
-- full shared history for users who had deleted-for-me, violating independent
-- per-user chat history.
--
-- Correct model:
--   conversation_participants.hidden_at = per-user deletion boundary.
--   Messages with created_at <= hidden_at stay invisible to that user.
--   New messages after the boundary reactivate the inbox for that user
--   WITHOUT clearing their boundary (application list/query logic).
--
-- This migration:
--   1) Replaces the trigger so new messages only bump conversations.updated_at.
--   2) Never clears another user's (or the sender's) hidden_at.
--   3) Adds supporting indexes / comments.updated_at for comment edits.
-- Additive and idempotent. Safe to re-run. No shared messages are deleted.

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_hidden
  ON public.conversation_participants (user_id, hidden_at);

-- Speed per-user visibility filters: created_at > hidden_at / after cursors.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
  ON public.messages (conversation_id, created_at);

-- Comment edit modification timestamp (optional for clients; used by PATCH).
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Mentions may reference a comment for deep links (from 023; ensure present).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mentions'
  ) THEN
    ALTER TABLE public.mentions
      ADD COLUMN IF NOT EXISTS comment_id UUID;
  END IF;
END $$;

-- Replace the unsafe unhide function: bump conversation activity only.
CREATE OR REPLACE FUNCTION public.messages_after_insert_unhide()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
     SET updated_at = COALESCE(NEW.created_at, now())
   WHERE id = NEW.conversation_id;
  -- Intentionally do NOT clear conversation_participants.hidden_at.
  -- Each participant keeps an independent deletion boundary.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_after_insert_unhide ON public.messages;

CREATE TRIGGER trg_messages_after_insert_unhide
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_after_insert_unhide();

-- Keep friendships self-check if missing (from 019; idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'friendships_no_self'
      AND conrelid = 'public.friendships'::regclass
  ) THEN
    DELETE FROM public.friendships
    WHERE requester_id IS NOT NULL
      AND receiver_id IS NOT NULL
      AND requester_id = receiver_id;
    ALTER TABLE public.friendships
      ADD CONSTRAINT friendships_no_self
      CHECK (requester_id <> receiver_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comments_post_id_created_at_desc
  ON public.comments (post_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
