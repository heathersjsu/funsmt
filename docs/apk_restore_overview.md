概览
- 我们已从 app-release.apk 的 assets/index.android.bundle 成功提取并反编译 Hermes 字节码，产出伪代码与汇编，位置：
  - E:\Trae\pinme\build\bundles\HermesDecoded\index.android.bundle.decompiled.js
  - E:\Trae\pinme\build\bundles\HermesDecoded\index.android.bundle.hasm
  - E:\Trae\pinme\build\bundles\HermesDecoded\bundle.info.txt
- 以下内容是基于伪代码的页面与模块索引、与 Supabase 的接口交互摘要，以及与当前仓库源码的映射建议。

页面与功能模块索引（来自伪代码匹配）
- ToysStackScreen（函数指纹存在）：
  - 关键词："Toys"、"open toys"、路由入口。
  - 对应源码建议：src/screens/Toys/ToyListScreen.tsx（列表页与导航入口）。
- fetchToys（存在调用日志字符串与函数指纹）：
  - 关键词："fetchToys called with sort:"、"fetchToys error:"、"Total toys:"。
  - 对应源码建议：ToyListScreen.tsx 内的 fetchToys 函数（按字母/最近添加/最受欢迎/默认更新时间排序）。
- RFID 相关：
  - handleRfidEvent、_handleRfidEvent、scanRfid、readRfidViaNfc、normalizeRfid、isValidRfid、formatRfidDisplay。
  - 对应源码建议：
    - src/utils/rfid.ts（normalize/isValid/format 显示），
    - src/screens/Toys/ToyFormScreen.tsx（扫描或录入 RFID）、
    - src/screens/Toys/ToyCheckInScreen.tsx（NFC 扫描快速入库）。
- 玩具状态与提醒：
  - setToyStatus、_setToyStatus（状态切换 in/out）、IdleToySettingsScreen、loadIdleToySettings、saveIdleToySettings、_saveIdleToySettings、_loadIdleToySettings。
  - 文案指示存在“Time to tidy up toys!”、“Help toys go home!”、“IdleToySettings”。
  - 对应源码建议：
    - src/reminders/idleToy.ts 与 src/reminders/longPlay.ts（提醒逻辑），
    - src/screens/Reminders/ 与 src/screens/Tidying/（若存在专用页面），
    - src/screens/Me/ 或 Settings 下的 IdleToySettingsScreen（名称与导入位置按当前结构对应）。
- 认证与授权：
  - 大量 supabase-auth-js 的字符串，如 onAuthStateChange、SupabaseAuthClient、AuthTokenContext、signInWithOAuth、reauthenticate、getAuthenticatorAssuranceLevel、WebAuthn* 系列。
  - 对应源码建议：src/context/AuthTokenContext.ts、src/screens/Auth/*、Supabase client 初始化（src/supabaseClient.ts）。

Supabase 接口交互摘要（来自伪代码匹配）
- REST 与 RPC：
  - 出现 "rest/v1"、"/rpc/"，说明通过 supabase-js 使用 REST/RPC 调用；
  - 明确表/资源："toys"、"play_sessions"；
  - 日志与错误："Failed to load toys. Please check network settings and env variables."、"fetchToys error:"。
- 存储：
  - "storage/v1/object/" 与 "render/image/authenticated" 字样，说明存在图片或对象存储访问，可能用于 toy 的 photo_url 上传/展示（私有/鉴权渲染）。
- 认证：
  - "onAuthStateChange"、"SupabaseAuthClient"、"AuthTokenContext"、"signInWithOAuth"、"reauthenticate"；
  - 警示字符串：关于在非浏览器环境使用、token 安全、getSession 与 getUser 的安全性说明；
  - 在 Android 端可能涉及 WebAuthn 检测与异常处理（伪代码中存在 WebAuthn* 文本）。
- RLS（行级安全，推断）：
  - 存在 Authorization/InsufficientAuthorization 字样；
  - 结合当前仓库 supabase/migrations/20251019_update_toys_rls.sql 及 src/types.ts 的 user_id 字段，推断 toys/play_sessions 等表启用 RLS，需在调用时携带 session。

与当前仓库源码的对应关系与对齐建议
- src/types.ts：
  - ToyStatus = 'in' | 'out' 与伪代码中的 setToyStatus/_setToyStatus 语义吻合。
  - Toy 接口包含 id/user_id/name/rfid/photo_url/category/status 等，和伪代码中出现的 RFID、photo、分类/状态相关逻辑一致。
- src/utils/toys.ts、src/utils/playSessions.ts：
  - 可能承载 REST/RPC 的封装；建议对照伪代码中的 "toys"、"play_sessions" 调用点，统一排序/过滤参数命名（与 fetchToys 的 sort 文案一致）。
- src/supabaseClient.ts：
  - 与伪代码中 SupabaseAuthClient 初始化一致；需确保 EXPO_PUBLIC_SUPABASE_URL/ANON_KEY 与 APK 中域名一致，避免环境差异。
- src/screens/Toys/*：
  - ToyListScreen/ToyFormScreen/ToyCheckInScreen 与伪代码匹配的功能函数对应，建议核对：
    - 列表：排序（字母/最近/最受欢迎）、过滤（分类/所有者/状态）、实时订阅（toys/play_sessions）。
    - 表单：图片上传（storage/v1）、RFID 扫描/录入、各种属性编辑。
    - 入库：NFC 扫描、拍照上传、快速状态切换。
- 提醒与导航：
  - IdleToySettingsScreen 存在于伪代码；建议核对提醒设置保存与加载的表/存储实现，确保与当前 daily reminder（notify-out-toys）说明一致。

APK 原生层恢复（计划）
- Dex 反编译：
  - 路径：E:\Trae\pinme\build\apk_extract_release\classes*.dex
  - 工具：jadx（GUI/CLI）。
  - 如需自动导出：在本机安装完成后，可运行 `jadx -d <输出目录> <dex文件...>`；若命令不可用，可使用 GUI 打开 APK 或 dex 并导出源码。
- 可恢复内容：
  - AndroidManifest（已在 apk_extract_release 目录中），查看包名、权限、intent 过滤；
  - Java/Kotlin 近似源码（桥接层、NFC/BLE 依赖、Hermes 引擎 libhermes.so 的存在确认）。
  - 资源清单（res/ 与 resources.arsc 已存在）。

下一步实施计划（用于恢复到 APK 版本并完全对齐）
1) 生成“模块映射与差异清单”：
   - 抽取 decompiled.js 中的函数入口与关键字符串，映射到 src/* 文件；
   - 标注与现有实现的差异点（例如排序逻辑、订阅事件、错误文案）。
2) Supabase 交互核查与修正：
   - 对照 REST/RPC 调用点，核对 toys/play_sessions 的筛选、排序、分页、RLS 约束；
   - 核查 storage/v1 的上传/渲染链路（token 与 bucket 权限）。
3) 认证流程对齐：
   - 确认 onAuthStateChange 的使用场景与 useAuthToken 的上下文一致；
   - 对 OAuth/WebAuthn 相关边界情况的错误提示保持一致（必要时更新字符串与处理分支）。
4) 原生层导出与桥接核对（可选但建议）：
   - 反编译 Dex，查验 NFC/BLE 依赖初始化与权限；
   - 如发现与当前 RN 模块版本不一致，更新 Gradle 依赖与 Expo/React Native 配置。
5) 端到端验证：
   - 构建新的 Release（Hermes 开启），提取 index.android.bundle，与当前 HermesDecoded 进行抽样比对关键字符串与函数指纹；
   - 在设备上执行登录、玩具列表、RFID 扫描、图片上传、提醒与入库流程验证。

备注
- 伪代码无法完全恢复原始的变量/函数名与注释，但足以同步业务流程与接口调用；
- 若 APK 内不包含 source map，命名还原受限；但通过关键字符串与函数指纹仍可完成对齐。