-- RLS policies to allow device-scoped JWT to update its own device record
-- Assumptions:
--   - JWT is signed with project JWT secret
--   - JWT contains claim device_id and role="authenticated"

begin;

-- Ensure RLS is enabled
alter table public.devices enable row level security;

-- Allow selecting own device row (optional, helpful for debugging)
create policy devices_select_self
  on public.devices
  for select
  using (
    (
      current_setting('request.jwt.claims', true)::jsonb ? 'device_id'
    ) and (
      (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
    )
  );

-- Allow updating own device row (last_seen, wifi_signal, wifi_ssid, status)
create policy devices_update_self
  on public.devices
  for update
  using (
    (
      current_setting('request.jwt.claims', true)::jsonb ? 'device_id'
    ) and (
      (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
    )
  )
  with check (
    (
      current_setting('request.jwt.claims', true)::jsonb ? 'device_id'
    ) and (
      (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
    )
  );

commit;