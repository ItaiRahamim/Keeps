'use server';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OwnershipFailureCode =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_OR_NOT_FOUND'
  | 'STORAGE_ERROR'
  | 'DATABASE_ERROR';

export type MoveOwnedMediaResult =
  | { ok: true; id: string; memoryTag: string | null }
  | { ok: false; code: OwnershipFailureCode; message: string };

export type DeleteOwnedMediaResult =
  | { ok: true; id: string }
  | { ok: false; code: OwnershipFailureCode; message: string };

function normalizedUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return UUID_PATTERN.test(id) ? id : null;
}

function normalizedTicketName(value: unknown): string | null | undefined {
  if (value !== null && typeof value !== 'string') return undefined;
  const name = typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  if (name.length > 80) return undefined;
  return name || null;
}

function objectKeyFromStoredUrl(value: string, userId: string): string | null {
  let key = value.trim();
  if (!key) return null;

  if (/^https?:\/\//i.test(key)) {
    const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
    if (!publicBase) return null;
    try {
      const objectUrl = new URL(key);
      const baseUrl = new URL(publicBase);
      const basePath = baseUrl.pathname.replace(/\/+$/, '');
      if (objectUrl.origin !== baseUrl.origin) return null;
      if (basePath && !objectUrl.pathname.startsWith(`${basePath}/`)) return null;
      key = decodeURIComponent(objectUrl.pathname.slice(basePath.length)).replace(/^\/+/, '');
    } catch {
      return null;
    }
  } else {
    key = key.replace(/^\/+/, '');
  }

  if (key.includes('..') || key.includes('\\')) return null;
  return key.startsWith(`media/${userId}/`) ? key : null;
}

function createR2Client(): { client: S3Client; bucket: string } | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export async function moveOwnedMedia(
  mediaIdInput: unknown,
  ticketNameInput: unknown
): Promise<MoveOwnedMediaResult> {
  const mediaId = normalizedUuid(mediaIdInput);
  const memoryTag = normalizedTicketName(ticketNameInput);
  if (!mediaId || memoryTag === undefined) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Choose a valid photo and an album name of 80 characters or fewer.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Sign in again to move this memory.' };
  }

  const { data, error } = await supabase
    .from('media')
    .update({ memory_tag: memoryTag })
    .eq('id', mediaId)
    .eq('user_id', user.id)
    .select('id, memory_tag')
    .maybeSingle();
  if (error) {
    console.error('moveOwnedMedia Supabase error', error);
    return { ok: false, code: 'DATABASE_ERROR', message: `Could not move this memory: ${error.message}` };
  }
  if (!data) {
    return {
      ok: false,
      code: 'FORBIDDEN_OR_NOT_FOUND',
      message: 'Only the uploader can move this memory.',
    };
  }

  revalidatePath('/');
  revalidatePath('/profile');
  return { ok: true, id: data.id as string, memoryTag: data.memory_tag as string | null };
}

export async function deleteOwnedMedia(mediaIdInput: unknown): Promise<DeleteOwnedMediaResult> {
  const mediaId = normalizedUuid(mediaIdInput);
  if (!mediaId) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Choose a valid memory to delete.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Sign in again to delete this memory.' };
  }

  const { data: media, error: lookupError } = await supabase
    .from('media')
    .select('id, original_url, thumbnail_url')
    .eq('id', mediaId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (lookupError) {
    console.error('deleteOwnedMedia lookup error', lookupError);
    return { ok: false, code: 'DATABASE_ERROR', message: `Could not verify this memory: ${lookupError.message}` };
  }
  if (!media) {
    return {
      ok: false,
      code: 'FORBIDDEN_OR_NOT_FOUND',
      message: 'Only the uploader can delete this memory.',
    };
  }

  const storedUrls = [media.original_url, media.thumbnail_url].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  const keys = [...new Set(storedUrls.map((value) => objectKeyFromStoredUrl(value, user.id)))];
  if (keys.some((key) => key === null) || keys.length === 0) {
    return {
      ok: false,
      code: 'STORAGE_ERROR',
      message: 'Could not safely resolve this memory’s R2 object keys.',
    };
  }

  const r2 = createR2Client();
  if (!r2) {
    return { ok: false, code: 'STORAGE_ERROR', message: 'Cloudflare R2 deletion is not configured.' };
  }
  try {
    await Promise.all(
      keys.map((key) =>
        r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key as string }))
      )
    );
  } catch (error) {
    console.error('deleteOwnedMedia R2 error', error);
    return { ok: false, code: 'STORAGE_ERROR', message: 'Could not delete this memory from Cloudflare R2.' };
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('media')
    .delete()
    .eq('id', mediaId)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle();
  if (deleteError || !deleted) {
    console.error('deleteOwnedMedia database error', deleteError);
    return {
      ok: false,
      code: deleteError ? 'DATABASE_ERROR' : 'FORBIDDEN_OR_NOT_FOUND',
      message: deleteError
        ? `The files were removed, but the database row could not be deleted: ${deleteError.message}`
        : 'Only the uploader can delete this memory.',
    };
  }

  revalidatePath('/');
  revalidatePath('/profile');
  return { ok: true, id: mediaId };
}
