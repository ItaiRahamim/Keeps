-- Keeps — add optional manual album tags to `media`
--
-- This project uses hand-authored imperative migrations. 0001 and 0002
-- have already established the table, RLS policies, and authenticated-role
-- grants, so this additive column change intentionally leaves those access
-- controls untouched. The application normalizes blank input to NULL and
-- groups non-empty tags case-insensitively while preserving this value as
-- the album's display label.
--
-- This migration is NOT applied automatically. Apply it manually through
-- the Supabase Dashboard SQL Editor before deploying the matching app code.
alter table public.media
  add column if not exists memory_tag text;
