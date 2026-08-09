import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import AlbumDestination from '@/components/corkboard/AlbumDestination';
import { getMedia } from '@/lib/media/actions';
import { groupIntoLibraryAlbums } from '@/lib/media/clustering';
import { createClient } from '@/lib/supabase/server';
import type { MediaRow } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Album · memokeeps',
  description: 'Open a shared memokeeps album.',
};

type AlbumPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function matchingAlbumId(requestedId: string, candidateId: string): boolean {
  if (requestedId === candidateId || requestedId === encodeURIComponent(candidateId)) return true;
  try {
    return decodeURIComponent(requestedId) === candidateId;
  } catch {
    return false;
  }
}

function initialPageForMedia(albumItems: MediaRow[], mediaId: string | undefined): number {
  if (!mediaId) return 0;
  const itemIndex = albumItems.findIndex((item) => item.id === mediaId);
  if (itemIndex < 0) return 0;

  const item = albumItems[itemIndex];
  const savedPage = item.album_placement_initialized
    ? item.album_page_number ?? item.album_page_index
    : null;
  return Number.isInteger(savedPage) && savedPage !== null && savedPage >= 0
    ? savedPage
    : Math.floor(itemIndex / 3);
}

export default async function AlbumPage({
  params,
  searchParams,
}: AlbumPageProps) {
  const [{ id: requestedId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const albums = groupIntoLibraryAlbums(await getMedia());
  const album = albums.find((candidate) => matchingAlbumId(requestedId, candidate.id));
  if (!album) notFound();

  const mediaId = typeof query.media === 'string' ? query.media : query.media?.[0];

  return (
    <AlbumDestination
      album={album}
      currentUserId={user.id}
      initialPage={initialPageForMedia(album.items, mediaId)}
    />
  );
}
