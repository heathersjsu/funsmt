insert into storage.buckets (id, name, public)
values ('toy-photos', 'toy-photos', true)
on conflict (id) do nothing;