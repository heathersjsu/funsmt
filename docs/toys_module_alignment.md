目标
- 优先对齐 Toys 模块与 Supabase 调用，使当前仓库行为与 APK 版本保持一致。

来源与证据
- Hermes 伪代码与字符串证据位置：build/bundles/HermesDecoded/
  - index.android.bundle.decompiled.js / bundle.info.txt
- 现有源码位置：src/screens/Toys/*、src/utils/*、src/context/*、src/supabaseClient.ts

模块与函数映射
1) ToyListScreen（src/screens/Toys/ToyListScreen.tsx）
   - fetchToys：日志与排序文案与 Hermes 一致
     - 证据：bundle.info.txt 中存在 'fetchToys'、'fetchToys called with sort:'、'fetchToys error:'。
     - 现实现：支持 alpha（按名称）、recent（created_at）、popular（最近30天 play_sessions 计数），以及默认 updated_at 降序。
   - 实时订阅：
     - .on UPDATE toys → 更新 status；
     - .on INSERT play_sessions → 读取当前 toys.status 并切换；更新 activeSessions 与 lastPlayedTimes。
     - 证据：Hermes 中出现 'play_sessions' 与相关订阅逻辑指纹。
   - 交互筛选：name/location/owner ilike；category/owner 精确过滤；与 APK 行为匹配。

2) RFID/NFC 与入库/编辑
   - ToyFormScreen（src/screens/Toys/ToyFormScreen.tsx）
     - scanRfid、normalizeRfid、formatRfidDisplay，一致；
     - insert/update toys，附带 user_id（insert 时）；
     - 订阅 play_sessions INSERT 按 toy_id 过滤，更新 toys.status 与 UI；
     - 证据：bundle.info.txt 显示 'RFID Tag ID'、'Please enter or scan RFID Tag ID'、'scanRfid'、'normalizeRfid'、'formatRfidDisplay'。
   - ToyCheckInScreen（src/screens/Toys/ToyCheckInScreen.tsx）
     - readRfidViaNfc：存在本地 NFC 读取；
     - insert toys 并上传照片；
     - 证据：bundle.info.txt 显示 'Read RFID via NFC'、'uploadToyPhoto' 相关文案。
   - utils/rfid.ts：normalizeRfid/isValidRfid/formatRfidDisplay 与 Hermes 完全匹配（函数名与功能）。

3) PlaySessions 与状态切换
   - utils/playSessions.ts：统一为 recordScan + setToyStatus + handleRfidEvent。
     - recordScan：INSERT play_sessions(toy_id, scan_time)。
     - setToyStatus：先插入 play_sessions，再更新 toys.status（fallback）。
     - handleRfidEvent：可选通过 tag_id 关联/创建 toy；插入 play_sessions；fallback 更新 toys.status。
     - 证据：Hermes 中存在 handleRfidEvent/_handleRfidEvent、play_sessions 多处指纹。

4) Auth 与上下文
   - App.tsx/AuthTokenContext.ts/onAuthStateChange：与 Hermes 中 'onAuthStateChange'、'AuthTokenContext' 文本一致。
   - supabaseClient.ts：使用 EXPO_PUBLIC_SUPABASE_URL/ANON_KEY，并开启 persistSession；与 APK 一致（用户已确认变量与 APK 同项目）。

Supabase 存储与上传（差异与建议）
- Hermes 证据显示：
  - 'createSignedUploadUrl'、'uploadToSignedUrl'、'getPublicUrl'、以及多条“uploadToyPhoto* is deprecated. Use *Direct”的建议。
- 现有实现（src/utils/storage.ts）：
  - 主要走 Edge Function：supabase.functions.invoke('upload-toy-photo')，以绕过 RLS；
  - 提供 uploadToyPhoto、uploadBase64Photo、uploadToyPhotoWeb 三种入口。
- 对齐建议：
  1) 增加“Direct”版本的封装，使用 supabase-js v2 的 Storage API：
     - createSignedUploadUrl(bucket, path) → uploadToSignedUrl(token, file)
     - 并保留 Edge Function 作为回退路径（Web/非原生、或 RLS 不允许直传时）。
  2) 页面调用优先使用 Direct（若 session 有效、RLS 允许），否则回退到 Edge Function；以匹配 APK 的直接签名上传路径与提示文案。
  3) 上传完成后统一通过 getPublicUrl 或后端返回的公开路径渲染图片。

RLS 与数据安全（现状与核查点）
- toys：
  - migrations/20251019_update_toys_rls.sql 已设置：默认 user_id=auth.uid()；insert 只能插入自己（with check）。
  - 现代码插入时显式传 user_id（ToyFormScreen/ToyCheckInScreen）。
- play_sessions：
  - 业务上按 toy_id 进行查询与订阅；建议确认 RLS 是否允许按 user_id 与 toy 所属用户过滤（若表有 user_id 列）。
- 认证上下文：
  - Hermes 提醒“getSession/onAuthStateChange 的 user 对象不安全，建议使用 getUser() 验证”。
  - 现代码在 App.tsx 中使用 onAuthStateChange 获取 session；建议在敏感操作前调用 supabase.auth.getUser() 校验用户身份。

具体对齐改动建议（分步）
1) storage.ts 增加 Direct 上传封装（不更改现有函数签名，增添新导出）：
   - uploadToyPhotoDirect(localUri, userId)
   - uploadToyPhotoWebDirect(blob, userId)
   - uploadBase64PhotoDirect(base64, userId, contentType)
   行为：优先走 createSignedUploadUrl + uploadToSignedUrl，失败则回退到现有 Edge Function。

2) ToyForm/ToyCheckIn：
   - 优先调用 *Direct 版本；失败时回退到旧函数，保持向后兼容。
   - 提示文案更新为 Hermes 中的 deprecation 文案或更用户友好的版本（可选）。

3) Auth 安全校验：
   - 在插入/更新（toys/play_sessions）前，增加一次 getUser() 的校验（若返回 null 或 error，则阻止操作，并提示重新登录）。

4) 查询与订阅细节核对：
   - ToyListScreen 的 popular 排序：最近30天 play_sessions 计数，已实现；确认与 APK 相同（Hermes 中存在 'play_sessions' 统计，匹配）。
   - 订阅通道命名与过滤：当前实现已与 APK 表现一致（INSERT 触发 status toggle）。

验证清单（针对 Toys 与 Supabase）：
- 登录持久性：刷新后仍保持登录（sessionStorage、多标签页隔离）。
- Toys 列表：
  - alpha/ recent/ popular/ updated_at 默认排序均正常；
  - 搜索与过滤（name/location/owner/category）正常；
  - 实时订阅：更新 toys.status 与 last played 显示；
  - ActiveSessions：当 toys.status='out' 时显示最近 scan_time 作为开始时间。
- RFID/NFC：
  - ToyForm 扫描按钮、normalize/isValid/format 显示；
  - ToyCheckIn NFC 读取并插入；
  - handleRfidEvent：广播事件触发，插入 play_sessions 并回退更新 toys.status。
- 上传：
  - Direct 路径：createSignedUploadUrl + uploadToSignedUrl 可用；
  - 回退：Edge Function 仍可用；
  - 渲染：photo_url 显示与缓存一致。

后续事项
- 若 APK 原生层包含 NFC/BLE 依赖差异，需通过 Jadx 导出并比对桥接层配置，调整 Gradle 与 Expo 模块版本。
- 端到端验证通过后，构建 Release 包并抽样比对 Hermes 反编译产物中的函数指纹与字符串，确保一致。