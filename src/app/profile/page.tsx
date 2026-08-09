import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ProfileDashboard, {
  type ParticipatedAlbumSummary,
  type PersonalMemorySummary,
} from '@/components/profile/ProfileDashboard';
import { getMediaUrl } from '@/lib/contracts';
import { getMedia } from '@/lib/media/actions';
import { groupIntoAlbums } from '@/lib/media/clustering';
import { createClient } from '@/lib/supabase/server';
import type { MediaRow, UserProfile } from '@/lib/types';
import '@/components/corkboard/cork-texture.css';
import './profile.css';

export const metadata: Metadata = {
  title: 'Your profile · memokeeps',
  description: 'Your memories, albums, and memokeeps profile.',
};

function resolvedMediaUrl(value: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return getMediaUrl(value);
}

function memoryImage(media: MediaRow): string | null {
  return resolvedMediaUrl(
    media.thumbnail_url ?? (media.media_type === 'image' ? media.original_url : null)
  );
}

function timestampFor(media: MediaRow): string {
  return media.captured_at ?? media.created_at;
}

function titleForAlbum(items: MediaRow[]): string {
  const manualName = items.find((item) => item.memory_tag?.trim())?.memory_tag?.trim();
  if (manualName) return manualName;

  const timestamp = items[0] ? timestampFor(items[0]) : null;
  if (!timestamp) return 'A shared memory';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'A shared memory';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
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

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const [{ data: profileData, error: profileError }, media] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, avatar_url, created_at, updated_at')
      .eq('id', user.id)
      .maybeSingle(),
    getMedia(),
  ]);
  if (profileError) throw profileError;

  const profile: UserProfile = profileData
    ? (profileData as UserProfile)
    : {
        id: user.id,
        display_name: fallbackDisplayName(user),
        avatar_url: null,
        created_at: user.created_at,
        updated_at: user.updated_at ?? user.created_at,
      };

  const personalMemories: PersonalMemorySummary[] = media
    .filter((item) => item.user_id === user.id)
    .sort((a, b) => timestampFor(b).localeCompare(timestampFor(a)))
    .map((item) => ({
      id: item.id,
      title: item.caption?.trim() || item.memory_tag?.trim() || 'Untitled memory',
      albumName: item.memory_tag?.trim() || null,
      imageUrl: memoryImage(item),
      mediaType: item.media_type,
      timestamp: timestampFor(item),
    }));

  const participatedAlbums: ParticipatedAlbumSummary[] = groupIntoAlbums(media).flatMap((item) => {
    if (item.kind !== 'album' || !item.items.some((mediaItem) => mediaItem.user_id === user.id)) {
      return [];
    }
    return [{
      id: item.id,
      title: titleForAlbum(item.items),
      totalCount: item.items.length,
      contributedCount: item.items.filter((mediaItem) => mediaItem.user_id === user.id).length,
      previewUrls: item.items.map(memoryImage).filter((url): url is string => Boolean(url)).slice(0, 3),
    }];
  });

  return (
    <ProfileDashboard
      profile={profile}
      email={user.email ?? ''}
      personalMemories={personalMemories}
      participatedAlbums={participatedAlbums}
    />
  );
}
