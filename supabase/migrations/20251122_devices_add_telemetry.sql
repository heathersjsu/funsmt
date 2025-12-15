-- Add telemetry fields to devices table to support richer heartbeat payloads
alter table public.devices
  add column if not exists fw_version text,
  add column if not exists uptime_s bigint,
  add column if not exists free_heap integer;

comment on column public.devices.fw_version is 'Firmware version string reported by device';
comment on column public.devices.uptime_s  is 'Device uptime in seconds at last heartbeat';
comment on column public.devices.free_heap is 'Free heap (bytes) at last heartbeat';