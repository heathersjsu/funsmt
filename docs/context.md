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

<!-- Context Keeper 归档，下一节点：任意角色可安全读取 -->
