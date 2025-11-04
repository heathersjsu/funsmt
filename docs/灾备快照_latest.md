灾备快照（2025-10-24）

本快照记录当前项目的关键状态与恢复指引，便于系统崩溃后快速重建。

一、项目位置与结构
- 根目录：E:\Trae
- 前端应用：E:\Trae\pinme
- 关键目录与文件：
  - pinme/src/supabaseClient.ts（Supabase 客户端初始化）
  - pinme/src/screens/Toys/ToyListScreen.tsx（列表与排序逻辑）
  - pinme/src/screens/Toys/ToyFormScreen.tsx、ToyCheckInScreen.tsx（录入与拍照/图库）
  - pinme/src/screens/Stats/StatsScreen.tsx（统计）
  - pinme/src/utils/storage.ts（存储桶处理）
  - pinme/.env（环境变量：EXPO_PUBLIC_SUPABASE_URL、EXPO_PUBLIC_SUPABASE_ANON_KEY）
  - supabase/migrations（数据库迁移 SQL）
  - docs/灾备重建指南.md（完整重建步骤）

二、当前功能关键点（Toys 列表与排序）
- 排序选项：alpha（A–Z）、recent（按 created_at 降序）、popular（过去30天游玩次数降序，同次数按名称升序作为 tie-breaker）。
- 默认排序：alpha。
- 点击 All (A–Z)、Recently Added、Most Popular (30d) 时：清空分类筛选（categoryFilter、ownerFilter），切换 viewMode='all'，确保全部展示+应用排序。
- 分组视图按钮保留：View by Category、View by Owner、Status（不影响上述排序按钮的清除筛选行为）。

三、运行环境（当前 package.json 与启动日志）
- expo: 54.0.13（日志提示建议 54.0.19）
- react-native: 0.81.4（日志提示建议 0.81.5）
- react: 19.1.0
- react-native-svg: 15.14.0（日志提示建议 15.12.1）
- expo-camera: ~15.0.8（日志提示建议 ~17.0.8）
- expo-image: ^3.0.9（日志提示建议 ~3.0.10）
- expo-system-ui: ~6.0.7（日志提示建议 ~6.0.8）

四、当前开发服务
- Expo 隧道：exp://l4eup90-heatherzhu-8081.exp.direct（可跨网络扫描）
- 本地 Web：http://localhost:8081（可能被其他进程占用）

五、恢复步骤（本地）
1) 安装 Node 18/20 与 Git。
2) 从备份恢复或从仓库拉取到 E:\Trae。
3) 进入 E:\Trae\pinme，复制 .env.example 为 .env 并填写 Supabase URL/Anon Key。
4) 安装依赖：npm install（或 npm ci）。
5) 启动开发：npx expo start（跨网络可用：npx expo start --tunnel）。
6) 若使用 Web：npm run web（或 expo start --web --port 8083）。
7) 若数据库为空：运行 supabase/migrations 下的 SQL 至云端项目（或通过 CLI 迁移）。

六、数据与安全
- RLS 已启用，按 user_id 隔离数据。主要表：toys、play_sessions（最近30天统计使用）、device_tokens 等。
- Storage 桶：toy-photos（public=true，大小限制10MB，需服务角色创建或迁移脚本确保）。

七、已知注意事项
- Expo 版本与部分包版本与建议版本存在差异，升级后需回归测试。
- 8081 端口常驻，若被占用可切换到 8083/8084。
- Expo 隧道二维码为临时会话，仅用于当前开发期间；崩溃恢复后需重新启动以生成新二维码。

八、快速自检清单
- [ ] .env 正确填入 Supabase 项目地址与匿名密钥。
- [ ] npm install 成功且无严重 peer error。
- [ ] expo start 能启动，首页可加载 Toys 列表。
- [ ] All (A–Z)、Recently Added、Most Popular (30d) 点击后均清除分类并展示全部，排序生效。
- [ ] 三个分组视图按钮正常切换；在分组视图内排序按钮仍可返回“全部+排序”。
- [ ] Supabase 表存在，查询无权限错误（RLS）。

附：更多详尽流程与问题定位请参考 docs/灾备重建指南.md。