-- Align messages table with API (content / image_url / type) while keeping legacy text / image.
-- Safe to re-run.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'text';

-- Backfill newer columns from legacy ones
UPDATE public.messages SET content = text WHERE content IS NULL AND text IS NOT NULL;
UPDATE public.messages SET image_url = image WHERE image_url IS NULL AND image IS NOT NULL;

-- Backfill legacy columns from newer ones (if any rows were written to content only)
UPDATE public.messages SET text = content WHERE (text IS NULL OR text = '') AND content IS NOT NULL;
UPDATE public.messages SET image = image_url WHERE image IS NULL AND image_url IS NOT NULL;
