-- 1. 强制刷新 PostgREST Schema 缓存
NOTIFY pgrst, 'reload schema';

-- 2. 验证当前 device_id 的类型 (请在 Results 中查看输出)
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'devices' 
  AND column_name = 'device_id';
