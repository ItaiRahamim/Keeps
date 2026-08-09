-- Keeps — global authenticated collaboration on the shared media table
--
-- Every signed-in collaborator may read, create, and update every media row.
-- Anonymous access remains closed, and DELETE intentionally retains the
-- owner-only policy from 0001 because global deletion was not requested.
--
-- Media objects are stored in Cloudflare R2 (authenticated presigned PUTs
-- from /api/uploads/presign plus public R2 read URLs), not Supabase Storage.
-- Consequently this migration must not create policies on storage.objects.

alter table public.media enable row level security;

drop policy if exists "media_select_authenticated" on public.media;
drop policy if exists "media_insert_own" on public.media;
drop policy if exists "media_update_own" on public.media;

create policy "media_select_authenticated"
  on public.media
  for select
  to authenticated
  using (true);

create policy "media_insert_authenticated"
  on public.media
  for insert
  to authenticated
  with check (true);

create policy "media_update_authenticated"
  on public.media
  for update
  to authenticated
  using (true)
  with check (true);

-- RLS controls rows, while these grants expose the operations through the
-- Data API even on projects where public-schema privileges are opt-in.
grant usage on schema public to authenticated;
grant select, insert, update on table public.media to authenticated;

-- Agent 3 listens for INSERT events through Supabase Realtime. Publication
-- membership is separate from RLS/grants and must be added explicitly. The
-- catalog guard keeps this safe when the migration is rerun manually.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'media'
  ) then
    execute 'alter publication supabase_realtime add table public.media';
  end if;
end
$$;
