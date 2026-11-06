-- One exclusive 1:1 conversation per pair of users.
--
-- Safeguard against duplicate DM threads (e.g. two concurrent "Message" taps).
-- The app (src/lib/direct-pairs.ts) treats this table as optional: if it does
-- not exist it falls back to scanning conversation_participants, and the inbox
-- (GET /api/conversations) additionally collapses legacy duplicates per peer.
--
-- This migration is additive and non-destructive: no conversations, participants
-- or messages are modified or deleted. Existing duplicate threads stay in the
-- database; the pair simply points at the NEWEST one (by conversations.updated_at).

CREATE TABLE IF NOT EXISTS public.direct_conversation_pairs (
  user_a          UUID NOT NULL,
  user_b          UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CONSTRAINT direct_conversation_pairs_ordered CHECK (user_a < user_b)
);

CREATE INDEX IF NOT EXISTS idx_direct_conversation_pairs_conversation
  ON public.direct_conversation_pairs (conversation_id);

-- Service-role only (the backend uses supabaseAdmin). No client policies.
ALTER TABLE public.direct_conversation_pairs ENABLE ROW LEVEL SECURITY;

-- One-time backfill: every exclusive (exactly 2 participants) conversation,
-- keeping the newest per pair. Safe to re-run (ON CONFLICT DO NOTHING).
INSERT INTO public.direct_conversation_pairs (user_a, user_b, conversation_id)
SELECT DISTINCT ON (s.user_a, s.user_b) s.user_a, s.user_b, s.conversation_id
FROM (
  SELECT
    LEAST(p1.user_id, p2.user_id)    AS user_a,
    GREATEST(p1.user_id, p2.user_id) AS user_b,
    p1.conversation_id,
    c.updated_at
  FROM public.conversation_participants p1
  JOIN public.conversation_participants p2
    ON p2.conversation_id = p1.conversation_id
   AND p1.user_id < p2.user_id
  JOIN public.conversations c ON c.id = p1.conversation_id
  WHERE (
    SELECT COUNT(*) FROM public.conversation_participants x
    WHERE x.conversation_id = p1.conversation_id
  ) = 2
) s
ORDER BY s.user_a, s.user_b, s.updated_at DESC NULLS LAST
ON CONFLICT (user_a, user_b) DO NOTHING;

NOTIFY pgrst, 'reload schema';
