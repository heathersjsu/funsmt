-- RLS policies for toy-photos bucket to support direct signed uploads
-- Path convention: name = '<user_id>/<filename>'

DO $rls$
BEGIN
  -- Enable RLS on storage.objects (idempotent)
  begin
    execute 'alter table storage.objects enable row level security';
  exception when others then
    null;
  end;

  -- INSERT: allow authenticated users to insert into toy-photos under their own folder
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'toy_photos_insert_own_folder'
  ) then
    EXECUTE $pol$
      create policy "toy_photos_insert_own_folder"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'toy-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      )
    $pol$;
  end if;

  -- SELECT: allow authenticated users to list/view objects only in their own folder via API
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'toy_photos_select_own_folder'
  ) then
    EXECUTE $pol$
      create policy "toy_photos_select_own_folder"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'toy-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      )
    $pol$;
  end if;

  -- UPDATE: allow users to update (e.g., metadata) only their own objects
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'toy_photos_update_own_object'
  ) then
    EXECUTE $pol$
      create policy "toy_photos_update_own_object"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'toy-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      )
      with check (
        bucket_id = 'toy-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      )
    $pol$;
  end if;

  -- DELETE: allow users to delete only their own objects
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'toy_photos_delete_own_object'
  ) then
    EXECUTE $pol$
      create policy "toy_photos_delete_own_object"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'toy-photos'
        and split_part(name, '/', 1) = auth.uid()::text
      )
    $pol$;
  end if;
END
$rls$ LANGUAGE plpgsql;

-- Note:
-- - The bucket 'toy-photos' is public (per 20251016_create_storage_bucket.sql), so files are publicly accessible via CDN URLs.
-- - These policies restrict API access (list/select) to the owner's folder while still permitting direct signed uploads.
-- - The client uses createSignedUploadUrl/uploadToSignedUrl which requires INSERT permission under these policies.