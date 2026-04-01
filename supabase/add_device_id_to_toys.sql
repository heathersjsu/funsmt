-- 添加 device_id 字段到 toys 表
-- 用于明确每个玩具归属于哪台设备

BEGIN;

-- 1. 添加字段
ALTER TABLE public.toys 
ADD COLUMN IF NOT EXISTS device_id TEXT;

-- 2. 添加外键约束 (可选，如果 devices 表存在且 device_id 是主键或唯一键)
-- 注意：这里假设 devices 表的主键是 device_id 或者有一个名为 devices 的表
-- 如果 devices 表的主键是 id，且 device_id 是另外的列，请根据实际情况调整。
-- 查看之前的 types.ts，Device 接口有 id 和 device_id。通常 device_id 是物理 ID。
-- 这里的 device_id 字段我们将存储物理 device_id (字符串)。

-- 尝试添加外键约束，如果 devices 表存在
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'devices') THEN
        -- 检查 devices 表是否有 device_id 列并作为唯一约束
        IF EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conrelid = 'public.devices'::regclass 
            AND contype IN ('p', 'u')
            AND 'device_id' = ANY (
                SELECT attname FROM pg_attribute 
                WHERE attrelid = 'public.devices'::regclass 
                AND attnum = ANY (conkey)
            )
        ) THEN
            ALTER TABLE public.toys 
            ADD CONSTRAINT fk_toys_device 
            FOREIGN KEY (device_id) 
            REFERENCES public.devices (device_id)
            ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

-- 3. 创建索引以加速查询
CREATE INDEX IF NOT EXISTS idx_toys_device_id ON public.toys(device_id);

COMMIT;

-- 执行说明：
-- 请在 Supabase Dashboard 的 SQL Editor 中运行此脚本。
