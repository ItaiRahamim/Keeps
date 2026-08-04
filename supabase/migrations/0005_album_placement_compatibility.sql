-- Keeps — verified album placement persistence and deployed-name compatibility
--
-- User/deployed column names:
--   album_page_number, album_page_x, album_page_y
-- Existing application aliases from 0004:
--   album_page_index, album_pos_x, album_pos_y
--
-- The application stores normalized values in both X/Y pairs: 0 means the
-- top/left end of the card's available travel and 1 means bottom/right.
-- Dual-writing keeps databases deployed with either naming scheme working.
-- `album_placement_initialized` distinguishes legacy/default (0,0) tuples
-- from a future intentional drag to that exact origin.
--
-- Existing media RLS remains authoritative: only a row's owner may update
-- placement. Run this migration manually before deploying matching code.

alter table public.media
  add column if not exists album_page_number integer,
  add column if not exists album_page_x double precision,
  add column if not exists album_page_y double precision,
  add column if not exists album_page_index integer,
  add column if not exists album_pos_x double precision,
  add column if not exists album_pos_y double precision,
  add column if not exists album_placement_initialized boolean not null default false;

-- Prefer a complete, proportionally-valid deployed-name tuple and copy it
-- into the 0004 aliases. Legacy pixel tuples outside [0,1] are preserved in
-- their original columns but deliberately not marked initialized: without
-- the original page size they cannot be converted accurately, so the client
-- will replace them with a safe measured scatter on next open.
update public.media
set
  album_page_index = greatest(0, least(9999, album_page_number)),
  album_pos_x = album_page_x,
  album_pos_y = album_page_y
where album_page_number is not null
  and album_page_number between 0 and 9999
  and album_page_x between 0 and 1
  and album_page_y between 0 and 1;

-- If only 0004's aliases contain a complete valid tuple, populate the exact
-- deployed names without overwriting a complete tuple already present there.
update public.media
set
  album_page_number = album_page_index,
  album_page_x = album_pos_x,
  album_page_y = album_pos_y
where album_page_index is not null
  and album_pos_x between 0 and 1
  and album_pos_y between 0 and 1
  and (
    album_page_number is null
    or album_page_x is null
    or album_page_y is null
  );

-- Partial exact-name tuples are unusable. Clear them atomically so the page
-- opens as unpositioned instead of mixing coordinates from different eras.
update public.media
set
  album_page_number = null,
  album_page_x = null,
  album_page_y = null,
  album_placement_initialized = false
where not (
  (album_page_number is null and album_page_x is null and album_page_y is null)
  or
  (album_page_number is not null and album_page_x is not null and album_page_y is not null)
);

-- Backfill only meaningful proportional placements. NULL and legacy zero
-- tuples remain false and are immediately scattered + saved by OpenAlbum.
update public.media
set album_placement_initialized = true
where album_page_number is not null
  and album_page_x between 0 and 1
  and album_page_y between 0 and 1
  and not (album_page_x = 0 and album_page_y = 0);

-- Standalone-safe canonical constraints. These mirror 0004 and are added
-- idempotently for manually provisioned databases that skipped that file.
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

  if not exists (
    select 1 from pg_constraint
    where conname = 'media_album_page_compat_complete'
      and conrelid = 'public.media'::regclass
  ) then
    alter table public.media
      add constraint media_album_page_compat_complete
      check (
        (album_page_number is null and album_page_x is null and album_page_y is null)
        or
        (album_page_number is not null and album_page_x is not null and album_page_y is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'media_album_initialized_complete'
      and conrelid = 'public.media'::regclass
  ) then
    alter table public.media
      add constraint media_album_initialized_complete
      check (
        album_placement_initialized = false
        or (
          album_page_number is not null
          and album_page_number between 0 and 9999
          and album_page_x between 0 and 1
          and album_page_y between 0 and 1
          and album_page_index is not null
          and album_pos_x between 0 and 1
          and album_pos_y between 0 and 1
        )
      );
  end if;
end
$$;

comment on column public.media.album_page_number is
  'Zero-based album leaf number; dual-written with album_page_index.';
comment on column public.media.album_page_x is
  'Normalized horizontal card travel [0,1]; dual-written with album_pos_x.';
comment on column public.media.album_page_y is
  'Normalized vertical card travel [0,1]; dual-written with album_pos_y.';
comment on column public.media.album_placement_initialized is
  'True only after both album placement naming schemes have been explicitly verified.';
