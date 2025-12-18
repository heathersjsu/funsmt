-- Ensure toys INSERT works for authenticated users and defaults user_id
-- Idempotent & safe: guards on column existence and policy presence

DO $toys_insert$
BEGIN
  -- Set default for user_id to current authenticated user
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='toys' AND column_name='user_id'
  ) THEN
    EXECUTE 'alter table public.toys alter column user_id set default auth.uid()';
  END IF;

  -- Create INSERT policy if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='toys' AND policyname='toys_insert_authenticated'
  ) THEN
    EXECUTE $$
      create policy "toys_insert_authenticated"
      on public.toys
      for insert to authenticated
      with check (user_id = auth.uid())
    $$;
  END IF;
END
$toys_insert$ LANGUAGE plpgsql;

-- Optional: ensure table has UUID default on id if it's uuid without default
-- This section is safe to skip if id already has a default. Uncomment when needed.
-- DO $toys_id_default$
-- BEGIN
--   IF EXISTS (
--     SELECT 1 FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='toys' AND column_name='id' AND data_type='uuid'
--   ) THEN
--     -- Only set default if none present
--     PERFORM 1 FROM pg_attrdef d
--       JOIN pg_class c ON d.adrelid=c.oid
--       JOIN pg_namespace n ON c.relnamespace=n.oid
--       JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.adnum
--       WHERE n.nspname='public' AND c.relname='toys' AND a.attname='id';
--     -- If no default found, set gen_random_uuid()
--     -- EXECUTE 'alter table public.toys alter column id set default gen_random_uuid()';
--   END IF;
-- END
-- $toys_id_default$ LANGUAGE plpgsql;
