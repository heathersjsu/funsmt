-- 1. 临时删除依赖 device_id 的 RLS 策略
DROP POLICY IF EXISTS devices_select_self ON public.devices;
DROP POLICY IF EXISTS devices_update_self ON public.devices;

-- 2. 修改 device_id 类型为 text
ALTER TABLE public.devices ALTER COLUMN device_id TYPE text;

-- 3. 重新创建 RLS 策略 (逻辑不变，但现在适用于 text 类型)
-- 允许设备查询自己的记录
CREATE POLICY devices_select_self
  ON public.devices
  FOR SELECT
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
  );

-- 允许设备更新自己的记录
CREATE POLICY devices_update_self
  ON public.devices
  FOR UPDATE
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
  )
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
  );
