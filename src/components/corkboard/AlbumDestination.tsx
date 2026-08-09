'use client';

import { useRouter } from 'next/navigation';
import type { MediaRow } from '@/lib/types';
import OpenAlbum from './OpenAlbum';

type AlbumDestinationProps = {
  album: { id: string; items: MediaRow[] };
  currentUserId: string;
  initialPage: number;
};

export default function AlbumDestination({
  album,
  currentUserId,
  initialPage,
}: AlbumDestinationProps) {
  const router = useRouter();

  return (
    <OpenAlbum
      album={album}
      currentUserId={currentUserId}
      initialPage={initialPage}
      onClose={() => router.push('/profile')}
    />
  );
}
