-- ==========================================
-- PINME Device Heartbeat & Status Fix (All-in-One)
-- ==========================================

-- 1. 补全 devices 表缺失字段 (解决 400 Bad Request)
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS wifi_signal integer,
  ADD COLUMN IF NOT EXISTS wifi_ssid text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'offline';

COMMENT ON COLUMN public.devices.wifi_signal IS 'Wi-Fi RSSI signal strength (dBm)';
COMMENT ON COLUMN public.devices.wifi_ssid IS 'Connected Wi-Fi SSID';
COMMENT ON COLUMN public.devices.status IS 'Device online status (online/offline/provisioning)';

-- 2. 重建心跳处理触发器 (强制更新 last_seen 和 status)
DROP TRIGGER IF EXISTS devices_set_last_seen ON public.devices;
DROP TRIGGER IF EXISTS devices_update_heartbeat ON public.devices;
DROP TRIGGER IF EXISTS on_device_heartbeat ON public.devices; -- 清理之前的尝试

DROP FUNCTION IF EXISTS public.devices_set_last_seen();
DROP FUNCTION IF EXISTS public.devices_on_update_heartbeat();

CREATE OR REPLACE FUNCTION public.handle_device_heartbeat()
RETURNS TRIGGER AS $$
BEGIN
  -- 收到任何心跳/更新时，强制更新 last_seen 为服务器时间
  NEW.last_seen := now();
  
  -- 只要有心跳，就标记为 online
  IF NEW.status IS DISTINCT FROM 'online' THEN
    NEW.status := 'online';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_device_heartbeat
BEFORE UPDATE ON public.devices
FOR EACH ROW
EXECUTE FUNCTION public.handle_device_heartbeat();

-- 3. 配置离线检测任务 (2分钟超时)
CREATE OR REPLACE FUNCTION public.devices_offline_sweep()
RETURNS void AS $$
BEGIN
  UPDATE public.devices
  SET status = 'offline'
  WHERE (last_seen IS NULL OR last_seen < now() - INTERVAL '2 minute')
    AND status IS DISTINCT FROM 'offline';
END;
$$ LANGUAGE plpgsql;

-- 4. 调度 Cron Job (每分钟执行)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule('devices_offline_mark');
    PERFORM cron.schedule('devices_offline_mark', '* * * * *', 'SELECT public.devices_offline_sweep();');
  END IF;
END;
$$ LANGUAGE plpgsql;
