-- Keeps — independent placement inside physical album pages
--
-- These nullable fields deliberately do NOT reuse `pos_x` / `pos_y`, which
-- remain the photo's position on the global corkboard. `album_page_index`
-- selects a leaf inside the focused album, while `album_pos_x` / `_y` are
-- normalized against the available travel on that leaf (0 = top/left,
-- 1 = bottom/right). Normalized coordinates keep a saved arrangement
-- proportional and fully bounded when the album is reopened on a different
-- screen size.
--
-- Existing rows remain NULL and receive deterministic client-side defaults
-- until somebody drags them inside an album. The existing `media` RLS
-- policies and authenticated table grant from 0001 continue to secure these
-- additive columns: authenticated users can read the shared board, while
-- only a row's owner can persist an update.
--
-- This migration is NOT applied automatically. Run it manually before
-- deploying the matching application code.
alter table public.media
  add column if not exists album_page_index integer,
  add column if not exists album_pos_x double precision,
  add column if not exists album_pos_y double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'media_album_page_index_range'
      and conrelid = 'public.media'::regclass
  ) then
    alter table public.media
      add constraint media_album_page_index_range
      check (album_page_index is null or album_page_index between 0 and 9999);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'media_album_pos_x_range'
      and conrelid = 'public.media'::regclass
  ) then
    alter table public.media
      add constraint media_album_pos_x_range
      check (album_pos_x is null or album_pos_x between 0 and 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'media_album_pos_y_range'
      and conrelid = 'public.media'::regclass
  ) then
    alter table public.media
      add constraint media_album_pos_y_range
      check (album_pos_y is null or album_pos_y between 0 and 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'media_album_placement_complete'
      and conrelid = 'public.media'::regclass
  ) then
    alter table public.media
      add constraint media_album_placement_complete
      check (
        (album_page_index is null and album_pos_x is null and album_pos_y is null)
        or
        (album_page_index is not null and album_pos_x is not null and album_pos_y is not null)
      );
  end if;
end
$$;

comment on column public.media.album_page_index is
  'Zero-based physical album leaf index; independent from global corkboard placement.';
comment on column public.media.album_pos_x is
  'Normalized horizontal travel within the album leaf, constrained to [0,1].';
comment on column public.media.album_pos_y is
  'Normalized vertical travel within the album leaf, constrained to [0,1].';
