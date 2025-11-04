-- Set default user_id to current authenticated user
alter table public.toys
  alter column user_id set default auth.uid();

-- Replace insert policy: only authenticated users can insert, and row must belong to themselves
do $$
begin
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='toys' and policyname='toys_insert_own'
  ) then
    drop policy "toys_insert_own" on public.toys;
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='toys' and policyname='toys_insert_authenticated'
  ) then
    create policy "toys_insert_authenticated" on public.toys
      for insert to authenticated
      with check (auth.uid() = user_id);
  end if;
end $$;