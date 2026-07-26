-- Optional helper so the backend can auto-apply SQL migrations via RPC.
-- Run this once in the Supabase SQL Editor (as postgres / service role).

CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM anon;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM authenticated;
-- Service role / dashboard SQL can still execute it as owner.
