-- Create backend tables for notification persistence and device tokens
-- Run this SQL in your Supabase project's SQL editor or apply via migrations

-- Notification history per user
create table if not exists public.notification_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  source text,
  created_at timestamptz not null default now()
);

alter table public.notification_history enable row level security;

-- RLS: users can read and insert their own rows
create policy if not exists "read own history" on public.notification_history for select
  using (auth.uid() = user_id);

create policy if not exists "insert own history" on public.notification_history for insert
  with check (auth.uid() = user_id);

-- Helpful index
create index if not exists notification_history_user_created_at_idx on public.notification_history (user_id, created_at desc);

-- Device tokens for push notifications
create table if not exists public.device_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.device_tokens enable row level security;

create policy if not exists "read own tokens" on public.device_tokens for select
  using (auth.uid() = user_id);

create policy if not exists "upsert own tokens" on public.device_tokens for insert
  with check (auth.uid() = user_id);

create policy if not exists "update own tokens" on public.device_tokens for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);