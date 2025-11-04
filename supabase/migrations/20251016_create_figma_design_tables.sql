-- Create tables to store Figma file metadata, styles, components, and sync runs
create schema if not exists public;

create table if not exists public.figma_files (
  file_key text primary key,
  name text,
  last_modified timestamptz
);

create table if not exists public.figma_styles (
  id text primary key,
  file_key text references public.figma_files(file_key) on delete cascade,
  key text,
  name text,
  style_type text,
  description text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_figma_styles_file on public.figma_styles(file_key);
create index if not exists idx_figma_styles_name on public.figma_styles(name);

create table if not exists public.figma_components (
  id text primary key,
  file_key text references public.figma_files(file_key) on delete cascade,
  key text,
  name text,
  description text,
  node_id text,
  updated_at timestamptz,
  created_at timestamptz
);
create index if not exists idx_figma_components_file on public.figma_components(file_key);
create index if not exists idx_figma_components_name on public.figma_components(name);

create table if not exists public.figma_sync_runs (
  id bigserial primary key,
  file_key text references public.figma_files(file_key) on delete cascade,
  team_id text,
  status text check (status in ('success','error')),
  started_at timestamptz,
  finished_at timestamptz,
  error_text text
);
create index if not exists idx_figma_sync_runs_file on public.figma_sync_runs(file_key);