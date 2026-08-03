-- Keeps — initial schema migration
--
-- No Supabase CLI is installed in this environment and there is no live
-- Supabase project yet (env vars in .env.local.example are blank
-- placeholders). This file was hand-authored and has NOT been applied
-- anywhere. Once a project exists, apply it via one of:
--   - `supabase db push` (if/when the CLI + project are linked), or
--   - the Supabase Dashboard's SQL Editor (paste and run this file), or
--   - `supabase migration up` / `supabase db query` against a linked project.
--
-- Access model (confirmed): one shared family board. Every authenticated
-- user can SELECT all media/clusters; a user can INSERT their own rows;
-- a user can UPDATE/DELETE only rows where user_id = auth.uid().

create table if not exists clusters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cover_media_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('image','video')),
  original_url text not null,
  thumbnail_url text,
  thumbnail_data text,
  caption text,
  lat_lng point,
  cluster_id uuid references clusters(id) on delete set null,
  pos_x double precision not null default 0,
  pos_y double precision not null default 0,
  rotation double precision not null default 0,
  z_index integer not null default 0,
  duration_ms integer,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

alter table clusters enable row level security;
alter table media enable row level security;

-- clusters: shared-board read for all authenticated users; no direct
-- client-side writes for now (cluster creation happens server-side / later feature)
create policy "clusters_select_authenticated" on clusters
  for select to authenticated using (true);

-- media: shared read, ownership-scoped write, per the confirmed access model.
-- Note the TO authenticated + ownership predicate pairing on every policy,
-- and BOTH using+with check on update (see supabase skill for why: without
-- WITH CHECK a user could reassign a row's user_id to someone else, and an
-- UPDATE without a SELECT policy silently affects 0 rows).
create policy "media_select_authenticated" on media
  for select to authenticated using (true);

create policy "media_insert_own" on media
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "media_update_own" on media
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "media_delete_own" on media
  for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists media_cluster_id_idx on media (cluster_id);
create index if not exists media_created_at_idx on media (created_at desc);

-- Exposing tables to the Data API (per .agents/skills/supabase/SKILL.md,
-- "Exposing tables to the Data API" / Supabase docs "Securing your API"):
-- on existing projects, new tables in `public` currently receive default
-- privileges for anon/authenticated/service_role automatically, but
-- Supabase is moving this to be opt-in on new projects. RLS alone gates
-- *rows*, not *table reachability* — grant explicit table-level privileges
-- so this works regardless of which default applies to the project this
-- migration ends up running against. These are intentionally narrower than
-- the docs' generic example: `anon` gets nothing (this app has no
-- unauthenticated access path — see proxy.ts), and `clusters` only gets
-- SELECT since there is no client-side insert/update/delete policy for it.
grant usage on schema public to authenticated;

grant select on table public.clusters to authenticated;
grant select, insert, update, delete on table public.media to authenticated;
