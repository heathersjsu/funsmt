-- Strengthen RLS for toys & play_sessions to align with client behavior and APK

do $$
begin
  -- Enable RLS on public.toys
  begin
    execute 'alter table public.toys enable row level security';
  exception when others then
    null;
  end;

  -- SELECT: owners only
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='toys' and policyname='toys_select_own'
  ) then
    execute $$
      create policy "toys_select_own"
      on public.toys
      for select to authenticated
      using (user_id = auth.uid())
    $$;
  end if;

  -- UPDATE: owners only
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='toys' and policyname='toys_update_own'
  ) then
    execute $$
      create policy "toys_update_own"
      on public.toys
      for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid())
    $$;
  end if;

  -- DELETE: owners only (optional)
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='toys' and policyname='toys_delete_own'
  ) then
    execute $$
      create policy "toys_delete_own"
      on public.toys
      for delete to authenticated
      using (user_id = auth.uid())
    $$;
  end if;
end $$;

-- RLS for play_sessions based on toy ownership
do $$
declare
  has_table boolean;
  has_toy_id boolean;
begin
  has_table := exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'play_sessions'
  );
  if not has_table then
    raise notice 'Table public.play_sessions not found; skip RLS configuration.';
    return;
  end if;

  -- Enable RLS
  begin
    execute 'alter table public.play_sessions enable row level security';
  exception when others then null; end;

  -- Column check
  has_toy_id := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'play_sessions' and column_name = 'toy_id'
  );

  if has_toy_id then
    -- SELECT: allow reading sessions of own toys
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='play_sessions' and policyname='play_sessions_select_own_toy'
    ) then
      execute $$
        create policy "play_sessions_select_own_toy"
        on public.play_sessions
        for select to authenticated
        using (
          exists (
            select 1 from public.toys t
            where t.id = play_sessions.toy_id
              and t.user_id = auth.uid()
          )
        )
      $$;
    end if;

    -- INSERT: allow inserting sessions for own toys
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='play_sessions' and policyname='play_sessions_insert_own_toy'
    ) then
      execute $$
        create policy "play_sessions_insert_own_toy"
        on public.play_sessions
        for insert to authenticated
        with check (
          exists (
            select 1 from public.toys t
            where t.id = play_sessions.toy_id
              and t.user_id = auth.uid()
          )
        )
      $$;
    end if;

    -- UPDATE: allow updating sessions only for own toys (if needed)
    if not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='play_sessions' and policyname='play_sessions_update_own_toy'
    ) then
      execute $$
        create policy "play_sessions_update_own_toy"
        on public.play_sessions
        for update to authenticated
        using (
          exists (
            select 1 from public.toys t
            where t.id = play_sessions.toy_id
              and t.user_id = auth.uid()
          )
        )
        with check (
          exists (
            select 1 from public.toys t
            where t.id = play_sessions.toy_id
              and t.user_id = auth.uid()
          )
        )
      $$;
    end if;
  else
    raise notice 'play_sessions.toy_id column missing; cannot apply ownership-based RLS policies.';
  end if;
end $$;