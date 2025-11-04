-- 1) 确保 supabase_realtime publication 存在（发布 INSERT/UPDATE/DELETE）
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime with (publish = ''insert, update, delete'')';
  end if;
end $$;

-- 2) 为 play_sessions 设置 REPLICA IDENTITY FULL（确保 UPDATE 事件包含完整新旧记录）
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'play_sessions'
  ) then
    execute 'alter table public.play_sessions replica identity full';
  else
    raise notice 'Table public.play_sessions not found; skip REPLICA IDENTITY.';
  end if;
end $$;

-- 3) 为 rfid_events 设置 REPLICA IDENTITY FULL（同上）
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'rfid_events'
  ) then
    execute 'alter table public.rfid_events replica identity full';
  else
    raise notice 'Table public.rfid_events not found; skip REPLICA IDENTITY.';
  end if;
end $$;

-- 4) 将 play_sessions 加入 supabase_realtime publication
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'play_sessions'
  ) then
    begin
      execute 'alter publication supabase_realtime add table public.play_sessions';
    exception
      when duplicate_object then
        -- 已加入，忽略
        null;
    end;
  else
    raise notice 'Table public.play_sessions not found; skip publication add.';
  end if;
end $$;

-- 4.1) 将 toys 加入 supabase_realtime publication（订阅 toys 的 UPDATE 用于状态切换）
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'toys'
  ) then
    begin
      execute 'alter publication supabase_realtime add table public.toys';
    exception
      when duplicate_object then
        null;
    end;
  else
    raise notice 'Table public.toys not found; skip publication add.';
  end if;
end $$;

-- 5) 将 rfid_events 加入 supabase_realtime publication（若表存在）
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'rfid_events'
  ) then
    begin
      execute 'alter publication supabase_realtime add table public.rfid_events';
    exception
      when duplicate_object then
        null;
    end;
  else
    raise notice 'Table public.rfid_events not found; skip publication add.';
  end if;
end $$;

-- 6) 为 rfid_events 启用 RLS，并基于现有列自动选择读取策略：
--    优先：按用户列归属（存在 user_id 列）-> 允许 auth.uid() = user_id
--    其次：按设备归属（存在 device_id 列）-> 允许设备 owner 读取（devices.user_id = auth.uid()）
do $$
declare
  has_table boolean;
  has_user_id boolean;
  has_device_id boolean;
begin
  has_table := exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'rfid_events'
  );

  if not has_table then
    raise notice 'Table public.rfid_events not found; skip RLS configuration.';
    return;
  end if;

  -- 启用 RLS
  execute 'alter table public.rfid_events enable row level security';

  -- 列检测
  has_user_id := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rfid_events' and column_name = 'user_id'
  );
  has_device_id := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rfid_events' and column_name = 'device_id'
  );

  if has_user_id then
    -- 策略：按用户列归属（user_id）
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'rfid_events' and policyname = 'rfid_events_select_user_owner'
    ) then
      execute '
        create policy "rfid_events_select_user_owner"
        on public.rfid_events
        for select
        using (auth.uid() = user_id)
      ';
    end if;
    raise notice 'Applied RLS: rfid_events SELECT by user_id ownership.';
  elsif has_device_id then
    -- 策略：按设备归属（基于 devices.device_id -> devices.user_id）
    -- 注意：devices.device_id 为 text；rfid_events.device_id 建议也为 text
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'rfid_events' and policyname = 'rfid_events_select_device_owner'
    ) then
      execute '
        create policy "rfid_events_select_device_owner"
        on public.rfid_events
        for select
        using (
          exists (
            select 1
            from public.devices d
            where d.device_id = rfid_events.device_id
              and d.user_id = auth.uid()
          )
        )
      ';
    end if;
    raise notice 'Applied RLS: rfid_events SELECT by device ownership via devices.user_id.';
  else
    -- 既无 user_id 又无 device_id，则无法选择上述策略
    raise notice 'rfid_events lacks user_id and device_id; no SELECT policy applied. Please add one of these columns.';
  end if;
end $$;