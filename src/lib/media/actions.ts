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
  'id, user_id, media_type, original_url, thumbnail_url, thumbnail_data, caption, memory_tag, lat_lng, captured_at, cluster_id, pos_x, pos_y, album_page_index, album_pos_x, album_pos_y, album_page_number, album_page_x, album_page_y, album_placement_initialized, rotation, z_index, duration_ms, width, height, created_at';

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

export type SavedAlbumPlacement = AlbumPlacement & { id: string };

export type AlbumPlacementFailureCode =
  | 'INVALID_PAYLOAD'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_OR_NOT_FOUND'
  | 'SCHEMA_MISMATCH'
  | 'RLS_DENIED'
  | 'CONSTRAINT_VIOLATION'
  | 'VERIFICATION_FAILED'
  | 'DATABASE_ERROR';

export type AlbumPlacementResult =
  | { ok: true; placement: SavedAlbumPlacement }
  | {
      ok: false;
      error: {
        code: AlbumPlacementFailureCode;
        message: string;
        details?: string;
        hint?: string;
      };
    };

type PostgrestErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAlbumPlacement(value: unknown): AlbumPlacement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const pageIndex = finiteNumber(input.pageIndex);
  const x = finiteNumber(input.x);
  const y = finiteNumber(input.y);

  if (
    pageIndex === null ||
    x === null ||
    y === null ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex > 9999 ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1
  ) {
    return null;
  }

  return { pageIndex, x, y };
}

function postgrestFailure(error: PostgrestErrorLike): Extract<AlbumPlacementResult, { ok: false }> {
  const code = typeof error.code === 'string' ? error.code : 'UNKNOWN';
  const rawMessage = typeof error.message === 'string' ? error.message : 'Unknown database error';
  const details = typeof error.details === 'string' && error.details ? error.details : undefined;
  const hint = typeof error.hint === 'string' && error.hint ? error.hint : undefined;
  const diagnostic = {
    details: [rawMessage, details].filter(Boolean).join(' — '),
    hint,
  };

  // Server-side structured logging preserves the exact PostgREST evidence
  // even when a deployment's generic HTTP error page would hide it.
  console.error('updateAlbumPlacement Supabase error', {
    code,
    message: rawMessage,
    details: details ?? null,
    hint: hint ?? null,
  });

  if (
    code === '42703' ||
    code === 'PGRST204' ||
    /column .* does not exist|schema cache.*column|could not find.*column/i.test(rawMessage)
  ) {
    return {
      ok: false,
      error: {
        code: 'SCHEMA_MISMATCH',
        message:
          'Album position columns are missing from Supabase. Run migration 0005_album_placement_compatibility.sql, then reload the PostgREST schema cache.',
        ...diagnostic,
      },
    };
  }

  // `.single()` reports PGRST116 when the ownership-filtered update returns
  // no row. Do not reveal whether a foreign row exists.
  if (code === 'PGRST116') {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_OR_NOT_FOUND',
        message: 'This photo was not found or your account cannot update it.',
        ...diagnostic,
      },
    };
  }

  if (code === '42501' || /row-level security|permission denied/i.test(rawMessage)) {
    return {
      ok: false,
      error: {
        code: 'RLS_DENIED',
        message: 'Supabase row-level security rejected the album position update.',
        ...diagnostic,
      },
    };
  }

  if (code === '23514' || code === '23502' || code === '22P02') {
    return {
      ok: false,
      error: {
        code: 'CONSTRAINT_VIOLATION',
        message: `Supabase rejected the album coordinates (${code}): ${rawMessage}`,
        ...diagnostic,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'DATABASE_ERROR',
      message: `Supabase could not save the album position (${code}): ${rawMessage}`,
      ...diagnostic,
    },
  };
}

/**
 * Persists a photo's proportional position inside a focused album without
 * touching `pos_x` / `pos_y`, which exclusively belong to the global board.
 * Authentication comes from the server-side cookie session, the update is
 * ownership-filtered here, and the existing media UPDATE RLS policy enforces
 * the same ownership boundary again in Postgres.
 */
export async function updateAlbumPlacement(
  id: string,
  placementInput: unknown
): Promise<AlbumPlacementResult> {
  const placement = normalizeAlbumPlacement(placementInput);
  const normalizedId = typeof id === 'string' ? id.trim() : '';
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalizedId
  );
  if (!placement || !isUuid) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message:
          'Invalid album position payload. Expected a media id, an integer pageIndex, and finite x/y coordinates between 0 and 1.',
      },
    };
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  let userId: string;
  try {
    supabase = await createClient();
    userId = await requireUserId(supabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Not authenticated';
    return {
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: `Album position was not saved: ${message}`,
      },
    };
  }

  const request = supabase
    .from('media')
    .update({
      album_page_index: placement.pageIndex,
      album_pos_x: placement.x,
      album_pos_y: placement.y,
      album_page_number: placement.pageIndex,
      album_page_x: placement.x,
      album_page_y: placement.y,
      album_placement_initialized: true,
    })
    .eq('id', normalizedId)
    .eq('user_id', userId)
    .select('id, album_page_index, album_pos_x, album_pos_y, album_page_number, album_page_x, album_page_y, album_placement_initialized')
    .single();
  const { data, error } = await Promise.resolve(request).catch((requestError: unknown) => ({
    data: null,
    error: {
      code: 'FETCH_ERROR',
      message:
        requestError instanceof Error
          ? requestError.message
          : 'The Supabase request failed before receiving a response',
    },
  }));

  if (error) return postgrestFailure(error);
  if (!data) {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_OR_NOT_FOUND',
        message: 'This photo was not found or your account cannot update it.',
      },
    };
  }

  const verified = data as {
    id: string;
    album_page_index: number | null;
    album_pos_x: number | null;
    album_pos_y: number | null;
    album_page_number: number | null;
    album_page_x: number | null;
    album_page_y: number | null;
    album_placement_initialized: boolean;
  };
  if (
    verified.id !== normalizedId ||
    verified.album_placement_initialized !== true ||
    verified.album_page_index !== placement.pageIndex ||
    verified.album_pos_x !== placement.x ||
    verified.album_pos_y !== placement.y ||
    verified.album_page_number !== placement.pageIndex ||
    verified.album_page_x !== placement.x ||
    verified.album_page_y !== placement.y
  ) {
    return {
      ok: false,
      error: {
        code: 'VERIFICATION_FAILED',
        message: 'Supabase returned album coordinates that did not match the requested position.',
        details: `requested=${JSON.stringify(placement)} returned=${JSON.stringify(verified)}`,
      },
    };
  }

  try {
    revalidatePath('/');
  } catch (error) {
    // The row is already written and verified. Cache invalidation must not
    // turn a successful placement into a client-visible 500/rollback.
    console.error('updateAlbumPlacement revalidation failed after verified save', error);
  }
  return {
    ok: true,
    placement: {
      id: verified.id,
      pageIndex: verified.album_page_index,
      x: verified.album_pos_x,
      y: verified.album_pos_y,
    },
  };
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
