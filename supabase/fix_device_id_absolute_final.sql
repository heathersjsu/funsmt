-- 最终修复：先清理所有策略，再修改类型，最后重建
-- 注意：这里使用 CASCADE 强制删除依赖 device_id 的对象（如视图或其他策略）
-- 请谨慎执行，确保没有其他重要依赖

BEGIN;

-- 1. 删除所有策略 (不带 CASCADE，防止误删，我们手动列举)
DROP POLICY IF EXISTS "device can select itself" ON public.devices;
DROP POLICY IF EXISTS "device can update itself" ON public.devices;
DROP POLICY IF EXISTS "devices_select_self" ON public.devices;
DROP POLICY IF EXISTS "devices_update_self" ON public.devices;
DROP POLICY IF EXISTS "Devices are viewable by owner" ON public.devices;
DROP POLICY IF EXISTS "Devices are insertable by owner" ON public.devices;
DROP POLICY IF EXISTS "Devices are updatable by owner" ON public.devices;
DROP POLICY IF EXISTS "Devices are deletable by owner" ON public.devices;

-- 2. 检查并移除可能存在的索引依赖 (通常索引不阻止类型转换，但为了保险)
DROP INDEX IF EXISTS devices_device_id_idx;

-- 3. 修改 device_id 类型为 text
-- 使用 USING 显式转换，确保现有数据（如果有）能正确转换
ALTER TABLE public.devices 
  ALTER COLUMN device_id TYPE text USING device_id::text;

-- 4. 重建索引
CREATE INDEX devices_device_id_idx ON public.devices(device_id);

-- 5. 重建策略

-- 用户策略
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

-- 设备策略
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

COMMIT;
