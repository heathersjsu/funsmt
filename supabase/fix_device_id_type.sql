-- 修复 device_id 类型错误 (UUID -> Text)
-- 错误原因：数据库中 device_id 是 UUID 类型，但设备上报的是 "pinme_..." 格式的文本 ID。
-- 解决方案：将 device_id 字段类型改为 text。

BEGIN;

-- 1. 尝试更改列类型
-- 注意：如果有外键约束依赖此列，可能需要先移除约束。
-- 这里使用 CASCADE 会自动处理依赖的主键约束，但可能会删除外键。
-- 鉴于目前是开发阶段，优先保证 ID 格式匹配。

ALTER TABLE public.devices 
  ALTER COLUMN device_id TYPE text;

COMMIT;
