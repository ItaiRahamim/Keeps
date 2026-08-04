'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { MediaRow, ClusterRow } from '@/lib/types';

// Row shape as it comes back from PostgREST, before `lat_lng` (a Postgres
// `point`) is normalized into MediaRow's `{ x, y } | null` shape. PostgREST
// has no special handling for geometric types, so `point` columns round-trip
// as their Postgres text form, e.g. "(1,2)" — see parsePoint/formatPoint.
type MediaRecord = Omit<MediaRow, 'lat_lng'> & { lat_lng: unknown };

const MEDIA_COLUMNS =
  'id, user_id, media_type, original_url, thumbnail_url, thumbnail_data, caption, memory_tag, lat_lng, captured_at, cluster_id, pos_x, pos_y, album_page_index, album_pos_x, album_pos_y, rotation, z_index, duration_ms, width, height, created_at';

const CLUSTER_COLUMNS = 'id, name, cover_media_id, created_at';

function parsePoint(raw: unknown): { x: number; y: number } | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const match = raw.match(/\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)/);
    if (!match) return null;
    return { x: Number(match[1]), y: Number(match[2]) };
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('x' in obj && 'y' in obj) {
      return { x: Number(obj.x), y: Number(obj.y) };
    }
  }
  return null;
}

function formatPoint(point: { x: number; y: number } | null | undefined): string | null {
  if (!point) return null;
  return `(${point.x},${point.y})`;
}

/**
 * Keeps the user-facing casing while making stored tags predictable. Empty
 * or whitespace-only values become NULL so they follow automatic EXIF
 * clustering rather than creating a hidden, empty manual album.
 */
function normalizeMemoryTagForStorage(tag: string | null | undefined): string | null {
  if (typeof tag !== 'string') return null;
  const normalized = tag.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (normalized.length > 80) {
    throw new Error('Memory or ticket name must be 80 characters or fewer');
  }
  return normalized || null;
}

function toMediaRow(record: MediaRecord): MediaRow {
  return {
    ...record,
    lat_lng: parsePoint(record.lat_lng),
  } as MediaRow;
}

/**
 * Confirms the caller has an active session and returns their user id.
 * Every write below relies on this rather than trusting anything the
 * caller passed in — RLS enforces ownership server-side regardless, but
 * failing fast here gives a clearer error than a opaque RLS-denied insert.
 */
async function requireUserId(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error('Not authenticated');
  }
  return user.id;
}

export async function getMedia(): Promise<MediaRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('media')
    .select(MEDIA_COLUMNS)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as MediaRecord[]).map(toMediaRow);
}

export async function getClusters(): Promise<ClusterRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clusters')
    .select(CLUSTER_COLUMNS)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ClusterRow[];
}

export async function createMedia(input: {
  media_type: 'image' | 'video';
  original_url: string;
  thumbnail_url: string;
  thumbnail_data: string; // tiny base64 LQIP
  caption?: string | null;
  memory_tag?: string | null;
  lat_lng?: { x: number; y: number } | null;
  captured_at?: string | null;
  cluster_id?: string | null;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
  pos_x: number;
  pos_y: number;
  rotation: number;
}): Promise<MediaRow> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data, error } = await supabase
    .from('media')
    .insert({
      user_id: userId, // server-derived — never trust a client-supplied user_id
      media_type: input.media_type,
      original_url: input.original_url,
      thumbnail_url: input.thumbnail_url,
      thumbnail_data: input.thumbnail_data,
      caption: input.caption ?? null,
      memory_tag: normalizeMemoryTagForStorage(input.memory_tag),
      lat_lng: formatPoint(input.lat_lng),
      captured_at: input.captured_at ?? null,
      cluster_id: input.cluster_id ?? null,
      duration_ms: input.duration_ms ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      pos_x: input.pos_x,
      pos_y: input.pos_y,
      rotation: input.rotation,
    })
    .select(MEDIA_COLUMNS)
    .single();

  if (error) throw error;

  revalidatePath('/');
  return toMediaRow(data as unknown as MediaRecord);
}

export async function updateMediaTransform(
  id: string,
  patch: Partial<Pick<MediaRow, 'pos_x' | 'pos_y' | 'rotation' | 'z_index'>>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;

  const supabase = await createClient();
  await requireUserId(supabase);

  const { error } = await supabase.from('media').update(patch).eq('id', id);
  if (error) throw error;

  revalidatePath('/');
}

export type AlbumPlacement = {
  pageIndex: number;
  x: number;
  y: number;
};

/**
 * Persists a photo's proportional position inside a focused album without
 * touching `pos_x` / `pos_y`, which exclusively belong to the global board.
 * Authentication comes from the server-side cookie session, the update is
 * ownership-filtered here, and the existing media UPDATE RLS policy enforces
 * the same ownership boundary again in Postgres.
 */
export async function updateAlbumPlacement(id: string, placement: AlbumPlacement): Promise<void> {
  if (!Number.isInteger(placement.pageIndex) || placement.pageIndex < 0 || placement.pageIndex > 9999) {
    throw new Error('Invalid album page index');
  }
  if (
    !Number.isFinite(placement.x) ||
    !Number.isFinite(placement.y) ||
    placement.x < 0 ||
    placement.x > 1 ||
    placement.y < 0 ||
    placement.y > 1
  ) {
    throw new Error('Invalid album page position');
  }

  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data, error } = await supabase
    .from('media')
    .update({
      album_page_index: placement.pageIndex,
      album_pos_x: placement.x,
      album_pos_y: placement.y,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Album placement could not be saved for this photo');
  revalidatePath('/');
}

export async function updateCaption(id: string, caption: string): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);

  const { error } = await supabase.from('media').update({ caption }).eq('id', id);
  if (error) throw error;

  revalidatePath('/');
}

export async function deleteMedia(id: string): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);

  const { error } = await supabase.from('media').delete().eq('id', id);
  if (error) throw error;

  revalidatePath('/');
}
