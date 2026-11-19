-- Enforce a strict maximum of 150 accepted friends per user.
-- 1) Adds accepted_at for accurate "newest friendship" ordering going forward.
-- 2) Audits + removes excess accepted friendships (oldest first) for users over 150.
-- 3) Adds a trigger so concurrent accepts cannot push either participant over 150.
-- Safe: does not delete users, messages, moments, reactions, comments, or notifications.
-- Idempotent: cleanup is a no-op when nobody is over the limit; objects use IF NOT EXISTS.

ALTER TABLE public.friendships
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Existing accepted rows: best available establishment time is created_at
-- (request creation). New accepts set accepted_at = now() via trigger/app.
UPDATE public.friendships
SET accepted_at = created_at
WHERE status = 'accepted'
  AND accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_friendships_accepted_at
  ON public.friendships (accepted_at DESC)
  WHERE status = 'accepted';

-- Audit of removed friendships (UUIDs only — no names/emails/messages).
CREATE TABLE IF NOT EXISTS public.friendship_limit_cleanup_audit (
  id BIGSERIAL PRIMARY KEY,
  friendship_id UUID NOT NULL,
  requester_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  established_at TIMESTAMPTZ,
  removed_for_user_id UUID NOT NULL,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.friendship_limit_cleanup_audit ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated → only service_role / table owner can read/write.

CREATE OR REPLACE FUNCTION public.cleanup_friendships_over_limit(p_limit integer DEFAULT 150)
RETURNS TABLE(removed_count integer, affected_users integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_count integer;
  v_excess integer;
  v_removed_total integer := 0;
  v_users_hit integer := 0;
  v_removed_this integer;
  f record;
  v_guard integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'invalid friend limit';
  END IF;

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 10000 THEN
      RAISE EXCEPTION 'friend limit cleanup exceeded safety guard';
    END IF;

    SELECT q.user_id, q.cnt
      INTO v_user_id, v_count
    FROM (
      SELECT user_id, COUNT(*)::integer AS cnt
      FROM (
        SELECT requester_id AS user_id
        FROM public.friendships
        WHERE status = 'accepted'
        UNION ALL
        SELECT receiver_id AS user_id
        FROM public.friendships
        WHERE status = 'accepted'
      ) edges
      GROUP BY user_id
      HAVING COUNT(*) > p_limit
      ORDER BY COUNT(*) DESC, user_id ASC
      LIMIT 1
    ) q;

    EXIT WHEN v_user_id IS NULL;

    v_excess := v_count - p_limit;
    v_removed_this := 0;

    -- Remove oldest accepted friendships first; keep the newest p_limit.
    FOR f IN
      SELECT
        id,
        requester_id,
        receiver_id,
        COALESCE(accepted_at, created_at) AS established_at
      FROM public.friendships
      WHERE status = 'accepted'
        AND (requester_id = v_user_id OR receiver_id = v_user_id)
      ORDER BY COALESCE(accepted_at, created_at) ASC, id ASC
      LIMIT v_excess
    LOOP
      INSERT INTO public.friendship_limit_cleanup_audit (
        friendship_id, requester_id, receiver_id, established_at, removed_for_user_id
      ) VALUES (
        f.id, f.requester_id, f.receiver_id, f.established_at, v_user_id
      );

      DELETE FROM public.friendships WHERE id = f.id;
      v_removed_total := v_removed_total + 1;
      v_removed_this := v_removed_this + 1;
    END LOOP;

    EXIT WHEN v_removed_this = 0;
    v_users_hit := v_users_hit + 1;
  END LOOP;

  removed_count := v_removed_total;
  affected_users := v_users_hit;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_accepted_friend_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := 150;
  v_requester_count integer;
  v_receiver_count integer;
BEGIN
  -- Stamp acceptance time when entering accepted status.
  IF NEW.status = 'accepted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted') THEN
    NEW.accepted_at := COALESCE(NEW.accepted_at, now());
  END IF;

  -- Only enforce when creating/becoming an accepted friendship.
  IF NEW.status IS DISTINCT FROM 'accepted' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Stable locks so concurrent accepts for the same users serialize.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(LEAST(NEW.requester_id, NEW.receiver_id)::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(GREATEST(NEW.requester_id, NEW.receiver_id)::text, 0)
  );

  SELECT COUNT(*)::integer INTO v_requester_count
  FROM public.friendships
  WHERE status = 'accepted'
    AND (requester_id = NEW.requester_id OR receiver_id = NEW.requester_id)
    AND id IS DISTINCT FROM NEW.id;

  SELECT COUNT(*)::integer INTO v_receiver_count
  FROM public.friendships
  WHERE status = 'accepted'
    AND (requester_id = NEW.receiver_id OR receiver_id = NEW.receiver_id)
    AND id IS DISTINCT FROM NEW.id;

  IF v_requester_count >= v_limit OR v_receiver_count >= v_limit THEN
    RAISE EXCEPTION 'FRIEND_LIMIT: maximum of % accepted friends', v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_accepted_friend_limit ON public.friendships;
CREATE TRIGGER trg_enforce_accepted_friend_limit
  BEFORE INSERT OR UPDATE OF status ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_accepted_friend_limit();

-- One-shot historical cleanup (safe to re-run: no-op when all users ≤ 150).
SELECT * FROM public.cleanup_friendships_over_limit(150);

-- Verify: no user should remain over the limit.
DO $$
DECLARE
  v_over integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_over
  FROM (
    SELECT user_id
    FROM (
      SELECT requester_id AS user_id FROM public.friendships WHERE status = 'accepted'
      UNION ALL
      SELECT receiver_id AS user_id FROM public.friendships WHERE status = 'accepted'
    ) e
    GROUP BY user_id
    HAVING COUNT(*) > 150
  ) x;

  IF v_over > 0 THEN
    RAISE EXCEPTION 'friend limit cleanup left % users over 150', v_over;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
