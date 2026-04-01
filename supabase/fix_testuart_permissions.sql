-- 修复 testuart 表的权限问题
-- 问题原因：ESP32 可能因 RLS (行级安全) 策略限制，无法更新或插入 testuart 表。
-- 解决方案：放开 testuart 表的读写权限，允许 App 和 ESP32 自由交互。

-- 1. 允许匿名用户 (ESP32) 和认证用户 (App) 对 testuart 表进行所有操作
-- (注意：这会允许任何持有 anon key 的人读写此表，仅适用于开发调试阶段)

BEGIN;

-- 确保 RLS 已启用 (为了应用策略)
ALTER TABLE public.testuart ENABLE ROW LEVEL SECURITY;

-- 清理旧策略 (如果有)
DROP POLICY IF EXISTS "Enable all access for testuart" ON public.testuart;
DROP POLICY IF EXISTS "Allow anon insert" ON public.testuart;
DROP POLICY IF EXISTS "Allow anon update" ON public.testuart;
DROP POLICY IF EXISTS "Allow anon select" ON public.testuart;

-- 创建全通策略
CREATE POLICY "Enable all access for testuart"
ON public.testuart
FOR ALL
USING (true)
WITH CHECK (true);

COMMIT;

-- 提示：
-- 请复制以上代码到 Supabase 的 SQL Editor 中执行。
-- 执行成功后，ESP32 应该就能成功保存扫描结果了。
