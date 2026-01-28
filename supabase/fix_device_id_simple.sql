-- 修复 device_id 类型错误 (UUID -> Text)
-- 请直接运行以下语句，不需要 BEGIN/COMMIT 包裹

ALTER TABLE public.devices ALTER COLUMN device_id TYPE text;
