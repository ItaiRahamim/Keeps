-- memokeeps — publicly readable uploader profiles linked to Supabase Auth
--
-- Profiles contain only presentation data that is safe to share with every
-- visitor. Authentication and authorization continue to
-- use auth.users/auth.uid(); raw_user_meta_data is copied only as an initial
-- display value and is never trusted for access control.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (char_length(btrim(display_name)) between 1 and 80),
  constraint profiles_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048)
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;

create policy "profiles_select_public"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

create policy "profiles_insert_self"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Keep the public Data API surface explicit. Everyone can read profiles;
-- authenticated users can edit only their own presentation columns.
revoke all on table public.profiles from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant insert (id, display_name, avatar_url) on table public.profiles to authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
  profile_avatar text;
begin
  profile_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    'member'
  );

  profile_avatar := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'picture'), '')
  );

  insert into public.profiles (
    id,
    display_name,
    avatar_url,
    created_at,
    updated_at
  )
  values (
    new.id,
    left(profile_name, 80),
    case when profile_avatar is null then null else left(profile_avatar, 2048) end,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- SECURITY DEFINER is required because Auth creates the row before a client
-- session exists. The function is trigger-only and must not be an exposed RPC.
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Provision every existing Auth user before adding the media -> profiles FK,
-- so the relationship validates without orphaned historic media rows.
insert into public.profiles (id, display_name, avatar_url, created_at, updated_at)
select
  users.id,
  left(
    coalesce(
      nullif(btrim(users.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(users.raw_user_meta_data ->> 'name'), ''),
      'member'
    ),
    80
  ),
  case
    when coalesce(
      nullif(btrim(users.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(btrim(users.raw_user_meta_data ->> 'picture'), '')
    ) is null then null
    else left(
      coalesce(
        nullif(btrim(users.raw_user_meta_data ->> 'avatar_url'), ''),
        nullif(btrim(users.raw_user_meta_data ->> 'picture'), '')
      ),
      2048
    )
  end,
  coalesce(users.created_at, now()),
  now()
from auth.users as users
on conflict (id) do nothing;

-- This explicit relationship lets PostgREST embed a media row's uploader
-- profile. The existing media -> auth.users constraint remains authoritative
-- for Auth lifecycle cascading.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'media_uploader_profile_fkey'
      and conrelid = 'public.media'::regclass
  ) then
    alter table public.media
      add constraint media_uploader_profile_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end
$$;

create index if not exists media_user_id_idx on public.media (user_id);

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_profile_updated_at() from public, anon, authenticated;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_profile_updated_at();
