-- Profile demographics required by Path+ signup / GenderGate
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS birthday TEXT,
  ADD COLUMN IF NOT EXISTS show_age BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS show_zodiac BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS username_changed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Optional: constrain gender once set (allow NULL for legacy rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_gender_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_gender_check
      CHECK (gender IS NULL OR gender IN ('Male', 'Female'));
  END IF;
END $$;
