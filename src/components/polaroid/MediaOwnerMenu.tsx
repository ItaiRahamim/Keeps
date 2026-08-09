'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { getMediaUrl } from '@/lib/contracts';
import { downloadMediaFile } from '@/lib/media/download';
import {
  deleteOwnedMedia,
  updateOwnedMediaDetails,
} from '@/lib/media/ownership-actions';
import type { MediaRow } from '@/lib/types';
import './media-owner-menu.css';

export type MediaDetailsPatch = {
  caption: string;
  memoryTag: string | null;
};

export type MediaOwnerMenuProps = {
  media: MediaRow;
  canManage: boolean;
  onDetailsChanged?: (id: string, patch: MediaDetailsPatch) => void;
  onDeleted?: (id: string) => void;
  onViewFullscreen?: (media: MediaRow) => void;
};

function shieldEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function resolveMediaUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : getMediaUrl(value);
}

export default function MediaOwnerMenu({
  media,
  canManage,
  onDetailsChanged,
  onDeleted,
  onViewFullscreen,
}: MediaOwnerMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'edit' | 'delete'>('menu');
  const [captionDraft, setCaptionDraft] = useState(media.caption ?? '');
  const [albumDraft, setAlbumDraft] = useState(media.memory_tag ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (isPending) return;
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setMode('menu');
        setError(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isPending) return;
      setIsOpen(false);
      setMode('menu');
      setError(null);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen, isPending]);

  function dismiss({ restoreFocus = false } = {}) {
    if (isPending) return;
    setIsOpen(false);
    setMode('menu');
    setError(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function submitDetails() {
    if (isPending || !canManage || !onDetailsChanged) return;
    setError(null);
    startTransition(async () => {
      const result = await updateOwnedMediaDetails(media.id, {
        caption: captionDraft,
        memoryTag: albumDraft,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDetailsChanged(result.id, {
        caption: result.caption,
        memoryTag: result.memoryTag,
      });
      setIsOpen(false);
      setMode('menu');
      setError(null);
    });
  }

  function submitDelete() {
    if (isPending || !canManage || !onDeleted) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteOwnedMedia(media.id);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDeleted(result.id);
    });
  }

  async function handleDownload() {
    if (isDownloading) return;
    setIsDownloading(true);
    setError(null);
    try {
      await downloadMediaFile(
        resolveMediaUrl(media.original_url),
        media.caption?.trim() || media.memory_tag?.trim() || 'memokeep'
      );
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Download failed.');
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="media-owner-menu"
      data-open={isOpen ? 'true' : undefined}
      onPointerDown={shieldEvent}
      onPointerUp={shieldEvent}
      onPointerCancel={shieldEvent}
      onClick={shieldEvent}
      onDoubleClick={shieldEvent}
    >
      <button
        ref={triggerRef}
        type="button"
        className="media-owner-menu-trigger"
        aria-label="Memory options"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((open) => !open);
          setMode('menu');
          setCaptionDraft(media.caption ?? '');
          setAlbumDraft(media.memory_tag ?? '');
          setError(null);
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>

      {isOpen ? (
        <div className="media-owner-menu-popover" role="dialog" aria-label="Memory options">
          {mode === 'menu' ? (
            <>
              {canManage && onDetailsChanged ? (
                <button type="button" onClick={() => setMode('edit')}>Edit details</button>
              ) : null}
              {onViewFullscreen ? (
                <button
                  type="button"
                  onClick={() => {
                    dismiss();
                    onViewFullscreen(media);
                  }}
                >
                  View fullscreen
                </button>
              ) : null}
              <button type="button" onClick={() => void handleDownload()} disabled={isDownloading}>
                {isDownloading ? 'Downloading…' : 'Download'}
              </button>
              {canManage && onDeleted ? (
                <button type="button" className="danger" onClick={() => setMode('delete')}>Delete memory</button>
              ) : null}
            </>
          ) : null}

          {mode === 'edit' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitDetails();
              }}
            >
              <label htmlFor={`edit-caption-${media.id}`}>Caption</label>
              <input
                id={`edit-caption-${media.id}`}
                autoFocus
                maxLength={280}
                value={captionDraft}
                onChange={(event) => setCaptionDraft(event.target.value)}
                disabled={isPending}
              />
              <label htmlFor={`edit-album-${media.id}`}>Album name</label>
              <input
                id={`edit-album-${media.id}`}
                maxLength={80}
                value={albumDraft}
                onChange={(event) => setAlbumDraft(event.target.value)}
                disabled={isPending}
              />
              <div className="media-owner-menu-actions">
                <button type="button" onClick={() => setMode('menu')} disabled={isPending}>Back</button>
                <button type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          ) : null}

          {mode === 'delete' ? (
            <div className="media-owner-delete-confirm">
              <p>Delete this memory permanently?</p>
              <div className="media-owner-menu-actions">
                <button type="button" onClick={() => setMode('menu')} disabled={isPending}>Cancel</button>
                <button type="button" className="danger" onClick={submitDelete} disabled={isPending}>
                  {isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="media-owner-menu-error" role="alert">{error}</p> : null}
          <button
            type="button"
            className="media-owner-menu-close"
            onClick={() => dismiss({ restoreFocus: true })}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
