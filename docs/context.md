# [记忆快照] 2025-12-16 10:05:00 | 版本 1.0.1

## 核心变更
1. **语音交互优化**
   - 修复误报：增加 `onSpeechPartialResults` 监听，减少 "No speech detected" 误报。
   - 交互体验：按住麦克风时 "Listening..." 持续显示（超时设为 600000ms），松开后错误提示仅显示 2秒。
   - 权限管理：App 启动及首次使用语音时强制请求麦克风权限（`PermissionsAndroid.request`）。

2. **开发环境修复**
   - 解决 `npx expo run:android` 连接失败问题，采用 ADB 端口转发 (`adb reverse`).
   - 计划重建 Android Dev Client 并启用 Tunnel 模式以解决网络连接问题。

## 关键文件状态
- `App.tsx`: 集成全局权限检查与语音监听逻辑。
- `src/screens/Voice/VoiceCommandScreen.tsx`: 优化 Snackbar 显示时长与错误处理流程。
- `app.config.ts`: 补充 Android/iOS 麦克风权限声明。

## 变更日志 (Timeline)
- **2025-12-16 10:00:00**: 初始化记忆快照 (v1.0.0)。
- **2025-12-16 10:05:00**: 用户确认变更，开发环境修复计划已批准 (v1.0.1)。

## 待办事项
- [ ] 重建并安装 Android Dev Client (已批准)
- [ ] 启动 Tunnel 模式 Expo 服务器 (已批准)
- [ ] 验证 Dev Client 隧道连接 (已批准)

# [记忆快照] 2025-12-18 14:30:00 | 版本 2025.12.18

## 核心变更
1. **UI 优化 (ReminderStatusScreen)**
   - **Owner 字体调整**: 在 Long Play 和 Idle Toy 扫描卡片中，将 `owner` 文本样式调整为与 `toyName` 一致。
   - 样式变更: `fontFamily: headerFont`, `fontSize: 16` (原为 small/body 样式)。
   - 目的: 提高 Owner 显示的显著性，与玩具名称视觉层级对齐。

2. **版本发布**
   - **Tag**: `v2025.12.18`
   - **目的**: 建立正式版本回滚点，防止后续崩溃无法恢复。

## 关键文件状态
- `src/screens/Reminders/ReminderStatusScreen.tsx`: 已更新 Owner 文本样式。
- `agents/memory.json`: 更新版本号至 `2025.12.18`。

## 变更日志 (Timeline)
- **2025-12-18 14:30:00**: 完成 UI 调整并准备发布 v2025.12.18。
- **2025-12-18 14:35:00**: 用户指定 **保留本地文件变更** (Keep all changes)，以本地文件为准，忽略 Git 暂存区差异。

# [记忆快照] 2026-01-06 12:00:00 | 版本 2026.01.06 (RFID Stable)

## 核心变更
1. **RFID 固件通信修复与优化 (ESP32)**
   - **Error Code 15 修复**:
     - 问题：`No Tag Found` 错误频发，参数配置不当。
     - 解决：实现 **Smart Poll (智能轮询)** 逻辑。
       - 策略：失败重试 Max 10次。
       - 第3次失败：自动调整 Query 参数为 `S1, Q=1` (0x1101)。
       - 第6次失败：自动调整 Query 参数为 `S1, Q=0` (0x1100) 并随机切换信道。
       - 成功：一旦读到标签立即返回。
   - **自动跳频 (Auto Frequency Hopping)**:
     - 新增 `RFID_CMD_SET_FREQ_HOPPING` (0xAD) 指令支持。
     - 允许读写器自动选择最佳信道，抗干扰能力增强。
   - **指令队列优化**:
     - 修复 **"无限重放历史指令"** Bug：设备启动时自动获取最新 ID，忽略旧的 Pending 指令。
     - 优化日志输出：屏蔽冗余的心跳 GET 日志，仅显示有效交互。

2. **App 端环境检测优化**
   - **EnvironmentCheckScreen**:
     - 新增 `Smart Poll` 按钮，一键触发智能重试逻辑。
     - 新增 `Raw Query` 配置按钮 (S1/S3, Q=4/6)。
     - 新增 `Auto Freq Hopping` 开关。

## 关键文件状态
- `esp32/device_setup/SupabaseCommands.h`: 包含 `testPollRetrySmart` 核心逻辑与队列清洗逻辑。
- `esp32/device_setup/RfidCommands.h`: 新增 `buildSetQueryRaw` 和 `buildSetFreqHopping`。
- `src/screens/Me/EnvironmentCheckScreen.tsx`: UI 适配新指令。

## 变更日志 (Timeline)
- **2026-01-06 10:00:00**: 收到 Code 15 报错，开始排查。
- **2026-01-06 11:30:00**: 完成 Smart Poll 逻辑编写。
- **2026-01-06 11:55:00**: 验证通过，标签成功读取 (RSSI -64dBm)。

<!-- Context Keeper 归档，下一节点：任意角色可安全读取 -->

# [记忆快照] 2026-01-20 16:30:00 | 版本 2026.01.20 (RFID UI/UX)

## 核心变更
1. **Toy Form RFID 扫描优化**
   - **自动填充**: 扫描成功后，自动截取 RFID 后6位填入 Tag ID 输入框。
   - **UI 重构**: 扫描弹窗改为 `Modal` + `Portal`，样式与 WiFi 配网弹窗统一（圆角、宽度、阴影）。
   - **交互优化**: 
     - 启动扫描时立即清空旧数据，防止 "No tags found" 闪烁。
     - 扫描中状态显示 "Scanning nearby tags..." 加载条（紧凑布局）。
     - 扫描结果列表只显示 Tag ID (后6位) 和 RSSI 信号强度，移除冗余 EPC 行。
   - **状态管理**: 增加 `scanRunningRef` 并在 async 操作后校验，防止组件卸载或手动停止后的状态竞态问题。

2. **数据库权限与逻辑修复**
   - **RLS 修复**: 修复 `testuart` 表的 RLS 策略，允许 authenticated 用户 INSERT。
   - **指令获取逻辑**: ESP32 端改为只获取 `id > lastExecutedId` 的指令，防止无限循环执行旧指令。

## 关键文件状态
- `src/screens/Toys/ToyFormScreen.tsx`: 扫描逻辑与 UI 重构核心文件。
- `supabase/fix_testuart_permissions.sql`: 权限修复 SQL。
- `esp32/device_setup/SupabaseCommands.h`: 指令获取逻辑更新。

## 变更日志 (Timeline)
- **2026-01-20 14:00:00**: 用户反馈扫描结果残留问题。
- **2026-01-20 15:30:00**: 完成 UI 统一化改造 (Modal) 与状态清洗逻辑。
- **2026-01-20 16:20:00**: 移除 EPC 显示行，优化 Scanning 提示高度。

<!-- Context Keeper 归档，下一节点：任意角色可安全读取 -->
