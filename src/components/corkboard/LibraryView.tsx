'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import type { MediaRow } from '@/lib/types';
import { getMediaUrl } from '@/lib/contracts';
import { pinColorForId, rotationForId } from '../lib/deterministic';
import './library-view.css';

export type LibraryAlbum = { id: string; items: MediaRow[] };

function resolveMediaUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return getMediaUrl(value);
}

function albumTitle(album: LibraryAlbum): string {
  const manualName = album.items.find((item) => item.memory_tag?.trim())?.memory_tag?.trim();
  if (manualName) return manualName;

  const first = album.items[0];
  const timestamp = first?.captured_at ?? first?.created_at;
  if (!timestamp) return 'Loose memory';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Loose memory';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export type ViewMode = 'board' | 'library';

export function ViewModeToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="view-mode-toggle"
      role="group"
      aria-label="Choose how to view your memories"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="view-mode-toggle-slider" data-mode={value} aria-hidden="true" />
      <button
        type="button"
        className="view-mode-toggle-button"
        aria-pressed={value === 'board'}
        disabled={disabled}
        onClick={() => onChange('board')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5.5h16v13H4zM8 5.5v13M16 5.5v13M4 10h16M4 14.5h16" />
        </svg>
        <span>Corkboard</span>
      </button>
      <button
        type="button"
        className="view-mode-toggle-button"
        aria-pressed={value === 'library'}
        disabled={disabled}
        onClick={() => onChange('library')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6.5h5v11H4zM10.5 5h5v12.5h-5zM17 7.5h3v10h-3z" />
        </svg>
        <span>Library</span>
      </button>
    </div>
  );
}

export default function LibraryView({
  albums,
  onOpen,
  inactive = false,
}: {
  albums: LibraryAlbum[];
  onOpen: (albumId: string) => void;
  inactive?: boolean;
}) {
  return (
    <motion.section
      key="library"
      className="library-view"
      aria-label="Memory album library"
      aria-hidden={inactive}
      inert={inactive ? true : undefined}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <header className="library-view-header">
        <p className="library-view-kicker">Your keepsakes</p>
        <h1>Album Library</h1>
        <p>Open a collection to leaf through its mini corkboard pages.</p>
      </header>

      {albums.length > 0 ? (
        <div className="library-shelves">
          {albums.map((album) => {
            const title = albumTitle(album);
            const previewItems = album.items.slice(0, 3);
            const count = album.items.length;

            return (
              <motion.button
                layoutId={`album-${album.id}`}
                key={album.id}
                type="button"
                className="library-album"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onOpen(album.id)}
                aria-label={`Open ${title}, ${count} ${count === 1 ? 'memory' : 'memories'}`}
                whileHover={{ y: -5 }}
                whileTap={{ scale: 0.98 }}
              >
                <span className="library-album-preview" aria-hidden="true">
                  {previewItems.map((item, index) => {
                    const source = item.thumbnail_url ? resolveMediaUrl(item.thumbnail_url) : null;
                    return (
                      <span
                        key={item.id}
                        className="library-album-photo"
                        style={{
                          '--preview-rotation': `${rotationForId(item.id)}deg`,
                          '--preview-offset-x': `${(index - 1) * 7}px`,
                          '--preview-offset-y': `${index * -3}px`,
                          '--preview-fan': `${(index - 1) * 2}deg`,
                        } as React.CSSProperties}
                      >
                        <span className="library-album-image">
                          {source ? <Image src={source} alt="" fill sizes="180px" draggable={false} /> : null}
                        </span>
                      </span>
                    );
                  })}
                  <span className="library-album-pin" data-color={pinColorForId(album.id)} />
                </span>
                <span className="library-album-label">
                  <strong>{title}</strong>
                  <span>
                    {count} {count === 1 ? 'memory' : 'memories'}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </div>
      ) : (
        <div className="library-empty">
          <p>Your library is waiting for its first memory.</p>
          <span>Add a photo with the + button below.</span>
        </div>
      )}
    </motion.section>
  );
}
