-- 补全 devices 表缺失字段，解决 heartbeat 400 错误

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS wifi_signal integer,
  ADD COLUMN IF NOT EXISTS wifi_ssid text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'offline';

-- 添加注释
COMMENT ON COLUMN public.devices.wifi_signal IS 'Wi-Fi RSSI signal strength (dBm)';
COMMENT ON COLUMN public.devices.wifi_ssid IS 'Connected Wi-Fi SSID';
COMMENT ON COLUMN public.devices.status IS 'Device online status (online/offline/provisioning)';

-- 确保 RLS 策略允许更新这些字段
-- (之前的 devices_update_self 策略通常是基于 row update，只要是 UPDATE 操作且符合 using 条件即可，
-- 但如果有限制 check ( ... )，需要确保新字段不违反 check。
-- devices_jwt_policy.sql 中的 check 只是再次检查 device_id，所以应该是安全的)
