-- Ensure toys.updated_at defaults to created_at at insert time, and auto-updates on row updates
-- Idempotent migration: guards on column existence and recreates trigger safely

-- 1) Set defaults (created_at/updated_at → now())
DO $set_defaults$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='toys' AND column_name='created_at'
  ) THEN
    EXECUTE 'alter table public.toys alter column created_at set default now()';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='toys' AND column_name='updated_at'
  ) THEN
    EXECUTE 'alter table public.toys alter column updated_at set default now()';
  END IF;
END
$set_defaults$ LANGUAGE plpgsql;

-- 2) Backfill existing rows where updated_at is NULL → set to created_at (or now() when created_at is NULL)
UPDATE public.toys
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

-- 3) Trigger to keep updated_at current on any UPDATE
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_on_toys ON public.toys;
CREATE TRIGGER set_updated_at_on_toys
BEFORE UPDATE ON public.toys
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();