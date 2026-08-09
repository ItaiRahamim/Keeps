'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { deleteOwnedMedia, moveOwnedMedia } from '@/lib/media/ownership-actions';
import './media-owner-menu.css';

type MediaOwnerMenuProps = {
  mediaId: string;
  memoryTag: string | null;
  onMoved: (id: string, memoryTag: string | null) => void;
  onDeleted: (id: string) => void;
};

function shieldEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export default function MediaOwnerMenu({
  mediaId,
  memoryTag,
  onMoved,
  onDeleted,
}: MediaOwnerMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'move' | 'delete'>('menu');
  const [draft, setDraft] = useState(memoryTag ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen]);

  function close() {
    if (isPending) return;
    setIsOpen(false);
    setMode('menu');
    setError(null);
  }

  function submitMove() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await moveOwnedMedia(mediaId, draft);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onMoved(result.id, result.memoryTag);
      close();
    });
  }

  function submitDelete() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteOwnedMedia(mediaId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDeleted(result.id);
    });
  }

  return (
    <div
      ref={rootRef}
      className="media-owner-menu"
      data-open={isOpen ? 'true' : undefined}
      onPointerDown={shieldEvent}
      onPointerUp={shieldEvent}
      onClick={shieldEvent}
      onDoubleClick={shieldEvent}
    >
      <button
        type="button"
        className="media-owner-menu-trigger"
        aria-label="Manage this memory"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((open) => !open);
          setMode('menu');
          setDraft(memoryTag ?? '');
          setError(null);
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>

      {isOpen ? (
        <div className="media-owner-menu-popover" role="dialog" aria-label="Manage memory">
          {mode === 'menu' ? (
            <>
              <button type="button" onClick={() => setMode('move')}>Move to album</button>
              <button type="button" className="danger" onClick={() => setMode('delete')}>Delete memory</button>
            </>
          ) : null}

          {mode === 'move' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitMove();
              }}
            >
              <label htmlFor={`move-memory-${mediaId}`}>Album name</label>
              <input
                id={`move-memory-${mediaId}`}
                autoFocus
                maxLength={80}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={isPending}
              />
              <div className="media-owner-menu-actions">
                <button type="button" onClick={() => setMode('menu')} disabled={isPending}>Back</button>
                <button type="submit" disabled={isPending}>{isPending ? 'Moving…' : 'Move'}</button>
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
          <button type="button" className="media-owner-menu-close" onClick={close} aria-label="Close menu">×</button>
        </div>
      ) : null}
    </div>
  );
}
