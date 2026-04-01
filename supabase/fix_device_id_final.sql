-- 1. 彻底清理所有可能依赖 device_id 的策略 (包括您刚刚报错提到的 'device can select itself')
DROP POLICY IF EXISTS "device can select itself" ON public.devices;
DROP POLICY IF EXISTS "device can update itself" ON public.devices;
DROP POLICY IF EXISTS "devices_select_self" ON public.devices;
DROP POLICY IF EXISTS "devices_update_self" ON public.devices;
DROP POLICY IF EXISTS "Devices are viewable by owner" ON public.devices;
DROP POLICY IF EXISTS "Devices are insertable by owner" ON public.devices;
DROP POLICY IF EXISTS "Devices are updatable by owner" ON public.devices;
DROP POLICY IF EXISTS "Devices are deletable by owner" ON public.devices;

-- 2. 修改 device_id 类型为 text
ALTER TABLE public.devices ALTER COLUMN device_id TYPE text;

-- 3. 重建所有必要的策略

-- 3.1 用户策略：允许用户管理自己的设备
CREATE POLICY "Devices are viewable by owner" 
ON public.devices FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Devices are insertable by owner" 
ON public.devices FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Devices are updatable by owner" 
ON public.devices FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Devices are deletable by owner" 
ON public.devices FOR DELETE 
USING (auth.uid() = user_id);

-- 3.2 设备策略：允许设备通过 JWT 访问自身
CREATE POLICY "device can select itself"
ON public.devices FOR SELECT
USING (
  (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
);

CREATE POLICY "device can update itself"
ON public.devices FOR UPDATE
USING (
  (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
)
WITH CHECK (
  (current_setting('request.jwt.claims', true)::jsonb ->> 'device_id') = device_id
);
