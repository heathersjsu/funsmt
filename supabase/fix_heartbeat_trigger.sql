-- 修复 last_seen 不更新的问题
-- 1. 清理可能存在的冲突触发器
DROP TRIGGER IF EXISTS devices_set_last_seen ON public.devices;
DROP TRIGGER IF EXISTS devices_update_heartbeat ON public.devices;

-- 2. 清理旧函数
DROP FUNCTION IF EXISTS public.devices_set_last_seen();
DROP FUNCTION IF EXISTS public.devices_on_update_heartbeat();

-- 3. 创建统一的心跳处理函数
CREATE OR REPLACE FUNCTION public.handle_device_heartbeat()
RETURNS TRIGGER AS $$
BEGIN
  -- 强制更新 last_seen 为服务器当前时间
  NEW.last_seen := now();
  
  -- 如果是心跳包，确保状态为 online
  IF NEW.status IS DISTINCT FROM 'online' THEN
    NEW.status := 'online';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. 创建触发器
CREATE TRIGGER on_device_heartbeat
BEFORE UPDATE ON public.devices
FOR EACH ROW
EXECUTE FUNCTION public.handle_device_heartbeat();
