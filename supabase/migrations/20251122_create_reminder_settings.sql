-- Create centralized reminder settings table per user
create table if not exists public.reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Long Play
  longplay_enabled boolean not null default false,
  longplay_duration_min integer not null default 45,
  longplay_methods jsonb not null default '{"push": true, "inApp": true}',
  -- Idle Toy
  idle_enabled boolean not null default false,
  idle_days integer not null default 14,
  idle_smart_suggest boolean not null default true,
  -- Smart Tidying
  tidying_enabled boolean not null default false,
  tidying_time text not null default '20:00', -- HH:MM
  tidying_repeat text not null default 'daily', -- daily | weekends | weekdays
  tidying_dnd_start text not null default '22:00',
  tidying_dnd_end text not null default '07:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reminder_settings enable row level security;

-- Idempotent RLS policies creation
DO $policies$
BEGIN
  -- SELECT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reminder_settings' AND policyname = 'reminder_settings_select_self'
  ) THEN
    EXECUTE $sql$
      create policy reminder_settings_select_self
      on public.reminder_settings for select
      to authenticated
      using (auth.uid() = user_id)
    $sql$;
  END IF;

  -- INSERT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reminder_settings' AND policyname = 'reminder_settings_insert_self'
  ) THEN
    EXECUTE $sql$
      create policy reminder_settings_insert_self
      on public.reminder_settings for insert
      to authenticated
      with check (auth.uid() = user_id)
    $sql$;
  END IF;

  -- UPDATE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reminder_settings' AND policyname = 'reminder_settings_update_self'
  ) THEN
    EXECUTE $sql$
      create policy reminder_settings_update_self
      on public.reminder_settings for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id)
    $sql$;
  END IF;
END
$policies$ LANGUAGE plpgsql;

-- Trigger to update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;$$;

drop trigger if exists reminder_settings_set_updated_at on public.reminder_settings;
create trigger reminder_settings_set_updated_at
  before update on public.reminder_settings
  for each row execute function public.set_updated_at();

-- Optional: include in realtime publication
do $$ begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.reminder_settings;
  end if;
end $$;