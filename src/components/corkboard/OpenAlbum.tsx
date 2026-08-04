'use client';

import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MediaRow } from '@/lib/types';
import { getMediaUrl } from '@/lib/contracts';
import './open-album.css';

export type OpenAlbumData = {
  id: string;
  items: MediaRow[];
};

export type OpenAlbumProps = {
  album: OpenAlbumData;
  onClose: () => void;
  initialPage?: number;
  /** Optional Framer shared-layout identity supplied by the corkboard. */
  layoutId?: string;
};

type Turn = {
  direction: -1 | 1;
  targetStart: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveMediaUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return getMediaUrl(value);
}

function memoryTagFor(media: MediaRow | undefined): string | null {
  const memoryTag = media?.memory_tag;
  const trimmed = memoryTag?.trim();
  return trimmed || null;
}

function captionFor(media: MediaRow, index: number): string {
  return media.caption?.trim() || `Photo ${index + 1}`;
}

type AlbumPageProps = {
  media: MediaRow | undefined;
  index: number;
  decorative?: boolean;
};

function AlbumPage({ media, index, decorative = false }: AlbumPageProps) {
  if (!media) {
    return (
      <div className="open-album-page open-album-page-empty" data-page-tone={index % 4}>
        <span className="open-album-page-flourish" aria-hidden="true" />
      </div>
    );
  }

  const source = media.thumbnail_url ?? (media.media_type === 'image' ? media.original_url : null);
  const caption = captionFor(media, index);

  return (
    <div className="open-album-page" data-page-tone={index % 4}>
      <div className="open-album-photo-frame">
        <div className="open-album-photo">
          {source ? (
            <Image
              src={resolveMediaUrl(source)}
              alt={decorative ? '' : caption}
              fill
              sizes="(max-width: 640px) 42vw, 390px"
              placeholder={media.thumbnail_data ? 'blur' : 'empty'}
              blurDataURL={media.thumbnail_data ?? undefined}
              draggable={false}
            />
          ) : (
            <svg className="open-album-photo-placeholder" viewBox="0 0 48 48" aria-hidden="true">
              <path d="M7 10.5h34v27H7z" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="18" cy="20" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m10 34 9-9 6.5 6 5-5L39 34" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
          {media.media_type === 'video' ? (
            <span className="open-album-video-mark" aria-label="Video">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m9 7 8 5-8 5V7Z" fill="currentColor" />
              </svg>
            </span>
          ) : null}
        </div>
        <p className="open-album-caption" dir="auto">{caption}</p>
      </div>
      <span className="open-album-page-number" aria-hidden="true">{index + 1}</span>
    </div>
  );
}

function OpenAlbumDialog({ album, onClose, initialPage = 0, layoutId }: OpenAlbumProps) {
  const shouldReduceMotion = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const lastSpreadStart = Math.max(0, Math.floor((album.items.length - 1) / 2) * 2);
  const safeInitialPage = clamp(Math.floor(initialPage), 0, Math.max(0, album.items.length - 1));
  const [spreadStart, setSpreadStart] = useState(Math.floor(safeInitialPage / 2) * 2);
  const [turn, setTurn] = useState<Turn | null>(null);

  const title = memoryTagFor(album.items[0]) ?? 'Memory album';
  const canGoBack = spreadStart > 0 && !turn;
  const canGoForward = spreadStart < lastSpreadStart && !turn;

  const requestTurn = useCallback((direction: -1 | 1) => {
    if (turn) return;
    const targetStart = spreadStart + direction * 2;
    if (targetStart < 0 || targetStart > lastSpreadStart) return;

    if (shouldReduceMotion) {
      setSpreadStart(targetStart);
      return;
    }

    setTurn({ direction, targetStart });
  }, [lastSpreadStart, shouldReduceMotion, spreadStart, turn]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        requestTurn(1);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        requestTurn(-1);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, requestTurn]);

  const visibleIndexes = useMemo(() => {
    const first = spreadStart + 1;
    const last = Math.min(album.items.length, spreadStart + 2);
    return first === last ? `${first}` : `${first}–${last}`;
  }, [album.items.length, spreadStart]);

  const visibleCaptions = album.items
    .slice(spreadStart, spreadStart + 2)
    .map((media, offset) => captionFor(media, spreadStart + offset))
    .join(', ');

  const baseLeftIndex = turn?.direction === -1 ? turn.targetStart : spreadStart;
  const baseRightIndex = turn?.direction === 1 ? turn.targetStart + 1 : spreadStart + 1;
  const sheetFrontIndex = turn?.direction === -1 ? turn.targetStart + 1 : spreadStart + 1;
  const sheetBackIndex = turn?.direction === -1 ? spreadStart : (turn?.targetStart ?? spreadStart);

  return (
    <motion.section
      ref={dialogRef}
      className="open-album-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.18 } }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.24, ease: 'easeOut' }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="open-album-header">
        <div className="open-album-heading-copy">
          <p className="open-album-kicker">Keeps album</p>
          <h2 id={titleId} dir="auto">{title}</h2>
          <p id={descriptionId}>{album.items.length} {album.items.length === 1 ? 'memory' : 'memories'}</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="open-album-close"
          onClick={onClose}
          aria-label="Close album and return to the corkboard"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
          <span>Back to board</span>
        </button>
      </div>

      <div className="open-album-stage">
        <button
          type="button"
          className="open-album-control open-album-control-previous"
          onClick={() => requestTurn(-1)}
          disabled={!canGoBack}
          aria-label="Show previous album pages"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
          <span>Previous</span>
        </button>

        <motion.div
          className="open-album-book"
          layoutId={layoutId}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse') return;
            swipeStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = swipeStartRef.current;
            swipeStartRef.current = null;
            if (!start || start.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - start.x;
            const deltaY = event.clientY - start.y;
            if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY)) return;
            requestTurn(deltaX < 0 ? 1 : -1);
          }}
          onPointerCancel={() => {
            swipeStartRef.current = null;
          }}
        >
          <div className="open-album-cover-edge" aria-hidden="true" />
          <div className="open-album-binding" aria-hidden="true" />
          <div className="open-album-static-page open-album-static-page-left" aria-hidden="true">
            <AlbumPage media={album.items[baseLeftIndex]} index={baseLeftIndex} decorative />
          </div>
          <div className="open-album-static-page open-album-static-page-right" aria-hidden="true">
            <AlbumPage media={album.items[baseRightIndex]} index={baseRightIndex} decorative />
          </div>

          {turn ? (
            <motion.div
              key={`${spreadStart}-${turn.direction}`}
              className="open-album-turning-sheet"
              initial={{ rotateY: turn.direction === 1 ? 0 : -180 }}
              animate={{ rotateY: turn.direction === 1 ? -180 : 0 }}
              transition={{
                type: 'spring',
                stiffness: 115,
                damping: 19,
                mass: 0.7,
              }}
              onAnimationComplete={() => {
                setSpreadStart(turn.targetStart);
                setTurn(null);
              }}
              aria-hidden="true"
            >
              <div className="open-album-sheet-face open-album-sheet-front">
                <AlbumPage media={album.items[sheetFrontIndex]} index={sheetFrontIndex} decorative />
              </div>
              <div className="open-album-sheet-face open-album-sheet-back">
                <AlbumPage media={album.items[sheetBackIndex]} index={sheetBackIndex} decorative />
              </div>
            </motion.div>
          ) : null}
        </motion.div>

        <button
          type="button"
          className="open-album-control open-album-control-next"
          onClick={() => requestTurn(1)}
          disabled={!canGoForward}
          aria-label="Show next album pages"
        >
          <span>Next</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        </button>
      </div>

      <div className="open-album-progress" aria-live="polite" aria-atomic="true">
        <span>Pages {visibleIndexes} of {album.items.length}</span>
        <span className="open-album-sr-only">. {visibleCaptions}</span>
      </div>
      <p className="open-album-gesture-hint" aria-hidden="true">Swipe a page or use the arrows to flip</p>
    </motion.section>
  );
}

/**
 * A controlled, full-viewport album experience. The corkboard owns which
 * album is open; this component owns only its transient page-turn state.
 */
export function OpenAlbum(props: OpenAlbumProps) {
  // Reset the internal spread naturally if a parent swaps album identity
  // without unmounting the overlay.
  return <OpenAlbumDialog key={props.album.id} {...props} />;
}

export default OpenAlbum;
