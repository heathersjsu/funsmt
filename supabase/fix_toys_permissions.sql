-- 放开 toys 和 play_sessions 表的权限
-- 问题原因：ESP32 使用匿名 Key (anon key) 更新状态时，被 RLS 策略拦截。
-- 解决方案：允许匿名用户 (ESP32) 和认证用户 (App) 对这些表进行读写操作。

BEGIN;

-- 1. 处理 toys 表
ALTER TABLE public.toys ENABLE ROW LEVEL SECURITY;

-- 清理旧策略
DROP POLICY IF EXISTS "Enable all access for toys" ON public.toys;
DROP POLICY IF EXISTS "Allow anon update toys" ON public.toys;
DROP POLICY IF EXISTS "Allow anon select toys" ON public.toys;
DROP POLICY IF EXISTS "Users can update their own toys" ON public.toys;
DROP POLICY IF EXISTS "Users can view their own toys" ON public.toys;

-- 创建全通策略 (允许 SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY "Enable all access for toys"
ON public.toys
FOR ALL
USING (true)
WITH CHECK (true);

-- 2. 处理 play_sessions 表 (用于记录玩耍时长)
ALTER TABLE public.play_sessions ENABLE ROW LEVEL SECURITY;

-- 清理旧策略
DROP POLICY IF EXISTS "Enable all access for play_sessions" ON public.play_sessions;
DROP POLICY IF EXISTS "Allow anon insert play_sessions" ON public.play_sessions;

-- 创建全通策略
CREATE POLICY "Enable all access for play_sessions"
ON public.play_sessions
FOR ALL
USING (true)
WITH CHECK (true);

COMMIT;

-- 执行说明：
-- 请复制此脚本内容，在 Supabase Dashboard 的 SQL Editor 中运行。
-- 运行后，ESP32 即可正常更新玩具状态和上传玩耍记录。
