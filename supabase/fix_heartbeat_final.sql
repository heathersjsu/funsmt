-- 彻底修复心跳逻辑 (Final Version)：
-- 1. 移除 "变更为 offline 绝不更新时间" 的限制，改为智能判断。
-- 2. 区分 "Cron设置为离线" 和 "设备发送心跳"。
-- 3. 修复离线设备发送心跳无法唤醒的问题。

CREATE OR REPLACE FUNCTION public.handle_device_heartbeat()
RETURNS TRIGGER AS $$
BEGIN
  -- 【场景A】 状态从 Online 变为 Offline (通常是定时任务或人工设置)
  -- 动作：直接放行，不强制更新时间，也不强制变回 Online。
  IF NEW.status = 'offline' AND OLD.status != 'offline' THEN
    RETURN NEW;
  END IF;

  -- 【场景B】 状态已经是 Offline，且本次更新没有试图变更为 Online
  -- 只有当检测到“真实心跳数据”（信号强度、配置）变化时，才唤醒设备。
  IF NEW.status = 'offline' AND OLD.status = 'offline' THEN
    IF (NEW.wifi_signal IS DISTINCT FROM OLD.wifi_signal) OR 
       (NEW.config IS DISTINCT FROM OLD.config) THEN
       -- 唤醒设备！
       NEW.status := 'online';
       NEW.last_seen := now();
       RETURN NEW;
    ELSE
       -- 可能是重复的离线标记，或者是修改了无关字段（如名字），保持离线。
       RETURN NEW;
    END IF;
  END IF;

  -- 【场景C】 用户编辑资料 (名字、位置、WiFi SSID)
  -- 动作：放行修改，但不视为心跳，不刷新时间。
  IF (NEW.name IS DISTINCT FROM OLD.name) OR 
     (NEW.location IS DISTINCT FROM OLD.location) OR
     (NEW.wifi_ssid IS DISTINCT FROM OLD.wifi_ssid) THEN
    RETURN NEW;
  END IF;

  -- 【场景D】 标准心跳 (Online -> Online 或其他情况)
  -- 动作：强制刷新时间和状态。
  NEW.status := 'online';
  NEW.last_seen := now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 确保触发器绑定正确
DROP TRIGGER IF EXISTS on_device_heartbeat ON public.devices;
CREATE TRIGGER on_device_heartbeat
BEFORE UPDATE ON public.devices
FOR EACH ROW
EXECUTE FUNCTION public.handle_device_heartbeat();
