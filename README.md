# Pinme

一个使用 Expo + Supabase 的家庭玩具管理应用。

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```
EXPO_PUBLIC_SUPABASE_URL=https://<YOUR_PROJECT_REF>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<YOUR_ANON_KEY>
```

## 运行

```
npm run web
```

或：

```
npx expo start
```

## 功能概览

- 邮箱注册/登录，找回密码。
- 玩具录入与列表：名称、RFID、照片、类别、来源、状态（在库/出库）、备注。
- 搜索与状态筛选，一键出库/入库。
- 每日 20:00 自动提醒（Edge Function + pg_cron），并含本地提醒兜底。

## 数据库与安全

- RLS 启用，按 `user_id` 隔离数据。
- 表：`toys`、`device_tokens`。

## 部署 Edge Function

在项目根（已链接 `Test`）运行：

```
supabase functions deploy notify-out-toys --project-ref <YOUR_PROJECT_REF>
```

为 Edge Function 设置密钥（服务角色）以访问数据库：

```
supabase secrets set SERVICE_ROLE_KEY=<YOUR_SERVICE_ROLE_KEY> --project-ref <YOUR_PROJECT_REF>
```

注意：`SUPABASE_URL` 和 `SUPABASE_ANON_KEY` 会在 Edge Functions 环境中自动可用，无需设置；前缀为 `SUPABASE_` 的变量不能通过 CLI 设置。

## Figma 设计数据同步（像数据库一样查询设计稿）

新增 `figma-sync` Edge Function：用 Figma Token 抓取文件/样式/组件/变量，并写入 Supabase 表以供 SQL 查询。

1) 配置项目密钥（无需 `SUPABASE_` 前缀）：

```
supabase secrets set SERVICE_ROLE_KEY=<YOUR_SERVICE_ROLE_KEY> --project-ref <YOUR_PROJECT_REF>
supabase secrets set FIGMA_TOKEN=<YOUR_FIGMA_PERSONAL_ACCESS_TOKEN> --project-ref <YOUR_PROJECT_REF>
```

2) 触发同步：

调用：

```
https://<YOUR_PROJECT_REF>.functions.supabase.co/figma-sync?file_key=<FILE_KEY>&team_id=<TEAM_ID>
```

3) 自动创建的数据表：
- `figma_files(file_key, name, last_modified)`
- `figma_styles(id, file_key, key, name, style_type, description, updated_at)`
- `figma_components(id, file_key, key, name, description, node_id, updated_at, created_at)`
- `figma_variables(id, team_id, collection_id, file_key, name, variable_type, modes, values, updated_at)`

4) 查询示例：

```
-- 查询颜色类变量
select name, variable_type, values from figma_variables where variable_type = 'COLOR';

-- 查询 Button 相关组件
select name, key, node_id from figma_components where name ilike '%Button%';

-- 查询文本样式
select name, style_type from figma_styles where style_type = 'TEXT';
```

## 打包与上架

使用 EAS：

```
npm install -g eas-cli
eas login
eas build -p android --profile production
eas build -p ios --profile production
eas submit -p android
eas submit -p ios
```