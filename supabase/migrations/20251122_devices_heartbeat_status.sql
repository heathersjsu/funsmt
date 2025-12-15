-- Devices heartbeat/status automation
-- 1) Ensure fast lookup by device_id
do $$ begin
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'devices_device_id_idx'
  ) then
    execute 'create index devices_device_id_idx on public.devices (device_id)';
  end if;
end $$;

-- 2) Update last_seen on any row update (PATCH from devices)
create or replace function public.devices_set_last_seen()
returns trigger language plpgsql as $$
begin
  -- Server-side authoritative heartbeat time
  new.last_seen = now();
  return new;
end;$$;

drop trigger if exists devices_set_last_seen on public.devices;
create trigger devices_set_last_seen
  before update on public.devices
  for each row execute function public.devices_set_last_seen();

-- 3) Optional: include in realtime publication
do $$ begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.devices;
  end if;
end $$;
-- This migration:
-- 1) Ensures last_seen is updated to server time on any UPDATE to devices
-- 2) Marks status='online' on heartbeat updates (any UPDATE)
-- 3) Schedules a cron job to mark devices 'offline' if last_seen older than 1 minute
-- 4) Adds helpful indexes

-- 1) Ensure required extensions
create extension if not exists moddatetime;
create extension if not exists pg_cron;

-- 2) Ensure columns exist (idempotent)
alter table if exists public.devices
  add column if not exists last_seen timestamptz;

-- 3) Trigger function: update last_seen and status on any UPDATE
create or replace function public.devices_on_update_heartbeat()
returns trigger as $$
begin
  -- Set last_seen to current server time
  new.last_seen := now();
  -- When row is updated (e.g., by device heartbeat), mark online
  if new.status is distinct from 'online' then
    new.status := 'online';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists devices_update_heartbeat on public.devices;
create trigger devices_update_heartbeat
before update on public.devices
for each row
execute function public.devices_on_update_heartbeat();

-- 4) Offline sweep function and pg_cron job: mark offline if no heartbeat in last 3 minutes
create or replace function public.devices_offline_sweep()
returns void as $$
begin
  update public.devices
  set status = 'offline'
  where (last_seen is null or last_seen < now() - interval '3 minute')
    and status is distinct from 'offline';
end;
$$ language plpgsql;

-- Schedule cron job to run every minute
-- Note: pg_cron stores jobs in the 'cron' schema tables; avoid duplicate schedule by checking jobs table when available
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if not exists (select 1 from cron.job where jobname = 'devices_offline_mark') then
      -- Use single-quoted command string inside DO $$...$$ to avoid dollar-quote collision
      perform cron.schedule('devices_offline_mark', '* * * * *', 'select public.devices_offline_sweep();');
    end if;
  end if;
end;
$$ language plpgsql;

-- 5) Helpful indexes
create index if not exists devices_device_id_idx on public.devices(device_id);
create index if not exists devices_last_seen_idx on public.devices(last_seen);

-- RLS/Policies are not modified here. Ensure your existing policies allow UPDATE by device with apikey + JWT as designed.
-- If pg_cron extension is unavailable in your project tier, you can implement the offline sweep with Supabase Edge Functions Scheduler
-- calling the same SQL: select public.devices_offline_sweep();