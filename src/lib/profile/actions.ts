'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getMediaUrl } from '@/lib/contracts';
import { createClient } from '@/lib/supabase/server';

const DisplayNameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Please enter your name.').max(80, 'Keep your name under 80 characters.'));

export type ProfileNameActionState =
  | { status: 'idle'; message: '' }
  | { status: 'success'; message: string; displayName: string }
  | { status: 'error'; message: string };

export type ProfileAvatarActionResult =
  | { ok: true; avatarUrl: string }
  | { ok: false; message: string };

async function authenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { supabase, user };
}

function fallbackDisplayName(user: {
  email?: string;
  user_metadata: Record<string, unknown>;
}): string {
  const metadataName = [
    user.user_metadata.display_name,
    user.user_metadata.full_name,
    user.user_metadata.name,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (metadataName) return metadataName.normalize('NFKC').trim().slice(0, 80);
  return user.email?.split('@')[0]?.trim().slice(0, 80) || 'member';
}

export async function updateProfileName(
  _previousState: ProfileNameActionState,
  formData: FormData
): Promise<ProfileNameActionState> {
  const auth = await authenticatedUser();
  if (!auth) return { status: 'error', message: 'Your session expired. Please sign in again.' };

  const parsed = DisplayNameSchema.safeParse(formData.get('displayName'));
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Please enter a valid name.' };
  }

  const updated = await auth.supabase
    .from('profiles')
    .update({ display_name: parsed.data })
    .eq('id', auth.user.id)
    .select('id')
    .maybeSingle();
  const insertError = updated.data
    ? null
    : (
        await auth.supabase.from('profiles').insert({
          id: auth.user.id,
          display_name: parsed.data,
          avatar_url: null,
        })
      ).error;
  if (updated.error || insertError) {
    console.error('Failed to update profile name', updated.error ?? insertError);
    return { status: 'error', message: 'We could not save your name. Please try again.' };
  }

  revalidatePath('/profile');
  return { status: 'success', message: 'Name saved.', displayName: parsed.data };
}

export async function updateProfileAvatar(avatarUrl: string): Promise<ProfileAvatarActionResult> {
  const auth = await authenticatedUser();
  if (!auth) return { ok: false, message: 'Your session expired. Please sign in again.' };

  const expectedPrefix = getMediaUrl(`avatars/${auth.user.id}/`);
  const parsedUrl = z.url().safeParse(avatarUrl);
  if (!parsedUrl.success || !expectedPrefix.startsWith('https://') || !avatarUrl.startsWith(expectedPrefix)) {
    return { ok: false, message: 'That avatar upload could not be verified.' };
  }

  const updated = await auth.supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', auth.user.id)
    .select('id')
    .maybeSingle();
  const insertError = updated.data
    ? null
    : (
        await auth.supabase.from('profiles').insert({
          id: auth.user.id,
          display_name: fallbackDisplayName(auth.user),
          avatar_url: avatarUrl,
        })
      ).error;
  if (updated.error || insertError) {
    console.error('Failed to update profile avatar', updated.error ?? insertError);
    return { ok: false, message: 'We uploaded the photo but could not save it to your profile.' };
  }

  revalidatePath('/profile');
  return { ok: true, avatarUrl };
}
