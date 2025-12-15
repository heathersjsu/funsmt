-- Unify reminder_settings schema across environments (idempotent and safe)

-- 1) Ensure target columns exist (preferred schema)
alter table public.reminder_settings
  add column if not exists longplay_push boolean default true,
  add column if not exists longplay_inapp boolean default true,
  add column if not exists idle_smart boolean default true,
  add column if not exists tidy_enabled boolean default false,
  add column if not exists tidy_time text default '20:00',
  add column if not exists tidy_repeat text default 'daily',
  add column if not exists tidy_dnd_start text default '22:00',
  add column if not exists tidy_dnd_end text default '07:00';

-- 2) Migrate legacy fields only when they exist (each DO block uses a named tag and LANGUAGE plpgsql)

-- longplay_methods (jsonb) → longplay_push + longplay_inapp
DO $migrate_lp$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reminder_settings' AND column_name = 'longplay_methods'
  ) THEN
    UPDATE public.reminder_settings
    SET longplay_push  = COALESCE(((longplay_methods ->> 'push')::boolean), longplay_push),
        longplay_inapp = COALESCE(((longplay_methods ->> 'inApp')::boolean), longplay_inapp)
    WHERE longplay_methods IS NOT NULL;
  END IF;
END
$migrate_lp$ LANGUAGE plpgsql;

-- idle_smart_suggest → idle_smart
DO $migrate_idle$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reminder_settings' AND column_name = 'idle_smart_suggest'
  ) THEN
    UPDATE public.reminder_settings
    SET idle_smart = COALESCE(idle_smart_suggest, idle_smart)
    WHERE idle_smart_suggest IS NOT NULL;
  END IF;
END
$migrate_idle$ LANGUAGE plpgsql;

-- tidying_* → tidy_* （每个字段独立迁移，避免引用缺失列）
DO $migrate_tidy$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reminder_settings' AND column_name='tidying_enabled')
  THEN UPDATE public.reminder_settings SET tidy_enabled = COALESCE(tidying_enabled, tidy_enabled); END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reminder_settings' AND column_name='tidying_time')
  THEN UPDATE public.reminder_settings SET tidy_time = COALESCE(tidying_time, tidy_time); END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reminder_settings' AND column_name='tidying_repeat')
  THEN UPDATE public.reminder_settings SET tidy_repeat = COALESCE(tidying_repeat, tidy_repeat); END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reminder_settings' AND column_name='tidying_dnd_start')
  THEN UPDATE public.reminder_settings SET tidy_dnd_start = COALESCE(tidying_dnd_start, tidy_dnd_start); END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reminder_settings' AND column_name='tidying_dnd_end')
  THEN UPDATE public.reminder_settings SET tidy_dnd_end = COALESCE(tidying_dnd_end, tidy_dnd_end); END IF;
END
$migrate_tidy$ LANGUAGE plpgsql;

-- 3) Optional: drop legacy columns after you confirm migration is good
alter table public.reminder_settings drop column if exists longplay_methods;
alter table public.reminder_settings drop column if exists idle_smart_suggest;
alter table public.reminder_settings drop column if exists tidying_enabled;
alter table public.reminder_settings drop column if exists tidying_time;
alter table public.reminder_settings drop column if exists tidying_repeat;
alter table public.reminder_settings drop column if exists tidying_dnd_start;
alter table public.reminder_settings drop column if exists tidying_dnd_end;