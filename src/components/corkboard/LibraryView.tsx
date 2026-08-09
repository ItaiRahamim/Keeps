'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { MediaRow } from '@/lib/types';
import { getMediaUrl } from '@/lib/contracts';
import { updateAlbumName } from '@/lib/media/actions';
import { pinColorForId, rotationForId } from '../lib/deterministic';
import { AlbumContributors } from './ContributorAttribution';
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

function manualAlbumName(album: LibraryAlbum): string | null {
  return album.items.find((item) => item.memory_tag?.trim())?.memory_tag?.trim() ?? null;
}

function LibraryAlbumCard({
  album,
  onOpen,
  onNameChange,
}: {
  album: LibraryAlbum;
  onOpen: (albumId: string) => void;
  onNameChange: (mediaIds: string[], name: string | null) => void;
}) {
  const title = albumTitle(album);
  const currentManualName = manualAlbumName(album);
  const previewItems = album.items.slice(0, 3);
  const count = album.items.length;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(currentManualName ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const suppressBlurCommitRef = useRef(false);

  async function commitName() {
    if (isSaving) return;
    const normalized = draft.normalize('NFKC').trim().replace(/\s+/g, ' ') || null;
    if (normalized === currentManualName) {
      setIsEditing(false);
      setErrorMessage('');
      return;
    }

    setIsSaving(true);
    setErrorMessage('');
    const result = await updateAlbumName(
      album.items.map((item) => item.id),
      normalized
    );
    setIsSaving(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    onNameChange(result.mediaIds, result.name);
    setIsEditing(false);
  }

  return (
    <motion.article
      layoutId={`album-${album.id}`}
      className="library-album"
      whileHover={{ y: -5 }}
      whileTap={{ scale: 0.98 }}
    >
      <button
        type="button"
        className="library-album-open-target"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (!isEditing) onOpen(album.id);
        }}
        aria-label={`Open ${title}, ${count} ${count === 1 ? 'memory' : 'memories'}`}
      />
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
        <span className="library-album-name-row">
          {isEditing ? (
            <input
              autoFocus
              className="library-album-name-input"
              value={draft}
              maxLength={80}
              placeholder={title}
              aria-label="Album or ticket name"
              disabled={isSaving}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                if (suppressBlurCommitRef.current) {
                  suppressBlurCommitRef.current = false;
                  return;
                }
                void commitName();
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  suppressBlurCommitRef.current = true;
                  setDraft(currentManualName ?? '');
                  setErrorMessage('');
                  setIsEditing(false);
                }
              }}
            />
          ) : (
            <strong dir="auto">{title}</strong>
          )}
          {!isEditing ? (
            <button
              type="button"
              className="library-album-rename"
              aria-label={`Rename ${title}`}
              title="Rename album"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                suppressBlurCommitRef.current = false;
                setDraft(currentManualName ?? '');
                setErrorMessage('');
                setIsEditing(true);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m4 16.5-.5 4 4-.5L18.7 8.8l-3.5-3.5L4 16.5Zm9.8-9.8 3.5 3.5" />
              </svg>
            </button>
          ) : null}
        </span>
        <span className="library-album-count">
          {isSaving ? 'Saving…' : `${count} ${count === 1 ? 'memory' : 'memories'}`}
        </span>
        <AlbumContributors mediaItems={album.items} />
        {errorMessage ? <small role="alert">{errorMessage}</small> : null}
      </span>
    </motion.article>
  );
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
      role="navigation"
      aria-label="Board navigation"
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
      <Link
        href="/profile"
        className="view-profile-link"
        aria-label="Open your profile"
        title="Your profile"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 19c.7-3.3 3-5 6.5-5s5.8 1.7 6.5 5" />
        </svg>
      </Link>
    </div>
  );
}

export default function LibraryView({
  albums,
  onOpen,
  onNameChange,
  inactive = false,
}: {
  albums: LibraryAlbum[];
  onOpen: (albumId: string) => void;
  onNameChange: (mediaIds: string[], name: string | null) => void;
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
          {albums.map((album) => (
            <LibraryAlbumCard
              key={album.id}
              album={album}
              onOpen={onOpen}
              onNameChange={onNameChange}
            />
          ))}
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
