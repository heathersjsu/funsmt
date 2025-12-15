-- Extend figma_variables to align with figma-sync function payload
alter table if exists public.figma_variables
  add column if not exists team_id text,
  add column if not exists collection_id text,
  add column if not exists file_key text,
  add column if not exists modes jsonb;

create index if not exists idx_figma_variables_file on public.figma_variables(file_key);