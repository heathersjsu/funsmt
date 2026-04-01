-- 1. 更新设备离线检测阈值为 2 分钟
CREATE OR REPLACE FUNCTION public.devices_offline_sweep()
RETURNS void AS $$
BEGIN
  UPDATE public.devices
  SET status = 'offline'
  WHERE (last_seen IS NULL OR last_seen < now() - INTERVAL '2 minute')
    AND status IS DISTINCT FROM 'offline';
END;
$$ LANGUAGE plpgsql;

-- 2. 确保 Cron Job 存在并正确调度 (每分钟运行一次)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 如果任务已存在，先删除旧任务以确保使用最新逻辑 (pg_cron 不会自动更新 command)
    PERFORM cron.unschedule('devices_offline_mark');
    
    -- 重新调度
    PERFORM cron.schedule('devices_offline_mark', '* * * * *', 'SELECT public.devices_offline_sweep();');
  END IF;
END;
$$ LANGUAGE plpgsql;
