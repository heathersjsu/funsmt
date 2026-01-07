-- 彻底修复 Heartbeat Loop 和 Ghost Online 问题
-- 1. 清理所有历史遗留的触发器 (防止多重触发器冲突)
DROP TRIGGER IF EXISTS devices_set_last_seen ON public.devices;
DROP TRIGGER IF EXISTS devices_update_heartbeat ON public.devices;
DROP TRIGGER IF EXISTS on_device_heartbeat ON public.devices;
DROP TRIGGER IF EXISTS devices_timestamp_fix ON public.devices;

-- 2. 清理相关函数
DROP FUNCTION IF EXISTS public.devices_set_last_seen();
DROP FUNCTION IF EXISTS public.devices_on_update_heartbeat();
DROP FUNCTION IF EXISTS public.handle_device_heartbeat();

-- 3. 创建更严格的心跳处理函数
CREATE OR REPLACE FUNCTION public.handle_device_heartbeat()
RETURNS TRIGGER AS $$
BEGIN
  -- 场景 A: 这是一个 "标记离线" 的操作 (通常来自定时任务)
  -- 特征: 状态从 'online' 变为 'offline'
  -- 动作: 允许变更，但绝不更新 last_seen
  IF NEW.status = 'offline' AND OLD.status = 'online' THEN
    RETURN NEW;
  END IF;

  -- 场景 B: 用户编辑设备信息 (名称、位置、SSID等)
  -- 特征: 关键业务字段发生变化
  -- 动作: 允许变更，不更新 last_seen (防止用户编辑导致设备“诈尸”)
  IF (NEW.name IS DISTINCT FROM OLD.name) OR 
     (NEW.location IS DISTINCT FROM OLD.location) OR
     (NEW.wifi_ssid IS DISTINCT FROM OLD.wifi_ssid) OR
     (NEW.wifi_password IS DISTINCT FROM OLD.wifi_password) THEN
    RETURN NEW;
  END IF;

  -- 场景 C: 设备心跳 (Heartbeat)
  -- 特征: 既不是标记离线，也不是用户编辑资料
  -- 动作: 强制标记为 online，并更新 last_seen
  NEW.status := 'online';
  NEW.last_seen := now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. 重新绑定触发器
CREATE TRIGGER on_device_heartbeat
BEFORE UPDATE ON public.devices
FOR EACH ROW
EXECUTE FUNCTION public.handle_device_heartbeat();
