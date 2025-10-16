create schema if not exists public;

create table if not exists public.figma_variables (
  id text primary key,
  name text not null,
  variable_type text not null,
  values jsonb not null,
  updated_at timestamptz not null default now()
);

-- Helpful index for querying by name/type
create index if not exists idx_figma_variables_name on public.figma_variables(name);
create index if not exists idx_figma_variables_type on public.figma_variables(variable_type);