-- Per-user inbox controls: pin chat + delete-for-me (hide from own inbox only).
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_hidden
  ON public.conversation_participants (user_id, hidden_at);

-- Ask PostgREST to reload so pinned_at / hidden_at are queryable immediately.
NOTIFY pgrst, 'reload schema';
