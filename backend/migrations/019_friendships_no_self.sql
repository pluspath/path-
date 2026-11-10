-- Prevent self-friendships / self-requests at the database layer.
-- Safe: removes any invalid self-rows first, then adds a CHECK constraint.
-- Does not modify valid friendships between distinct users.

DELETE FROM public.friendships
WHERE requester_id IS NOT NULL
  AND receiver_id IS NOT NULL
  AND requester_id = receiver_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'friendships_no_self'
      AND conrelid = 'public.friendships'::regclass
  ) THEN
    ALTER TABLE public.friendships
      ADD CONSTRAINT friendships_no_self
      CHECK (requester_id <> receiver_id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
