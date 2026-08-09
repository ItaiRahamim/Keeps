'use client';

import Image from 'next/image';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { MediaRow } from '@/lib/types';
import { getMediaUrl } from '@/lib/contracts';
import {
  updateAlbumPlacement,
  type AlbumPlacement,
  type SavedAlbumPlacement,
} from '@/lib/media/actions';
import { hashString, rotationForId } from '../lib/deterministic';
import { getPolaroidGeometry, POLAROID_MEDIA_WIDTH_PX } from '../polaroid/sizing';
import MediaOwnerMenu from '../polaroid/MediaOwnerMenu';
import Logo from '../brand/Logo';
import { PhotoContributor } from './ContributorAttribution';
import './open-album.css';

const MAX_ITEMS_PER_PAGE = 3;
const MAX_ALBUM_PAGE_INDEX = 9999;
const PAGES_PER_SPREAD = 2;
const KEYBOARD_NUDGE = 0.035;
const ALBUM_DRAG_SLOP_PX = 5;
const EDGE_HOVER_DELAY_MS = 750;
const EDGE_ZONE_MIN_PX = 52;
const EDGE_ZONE_MAX_PX = 96;

export type OpenAlbumData = {
  id: string;
  items: MediaRow[];
};

export type OpenAlbumProps = {
  album: OpenAlbumData;
  onClose: () => void;
  onPlacementChange?: (mediaId: string, placement: AlbumPlacement) => void;
  currentUserId?: string | null;
  onCaptionChange?: (id: string, caption: string) => void;
  onMemoryTagChange?: (id: string, memoryTag: string | null) => void;
  onDelete?: (id: string) => void;
  onMediaOpen?: (media: MediaRow) => void;
  initialPage?: number;
};

type Turn = {
  direction: -1 | 1;
  targetStart: number;
};

type PageEntry = {
  media: MediaRow;
  mediaIndex: number;
  placement: AlbumPlacement;
};

type AlbumLeaf = {
  index: number;
  entries: PageEntry[];
};

type AlbumDragStart = {
  event: ReactPointerEvent<HTMLElement>;
  media: MediaRow;
  placement: AlbumPlacement;
  card: HTMLDivElement;
  cardBookX: number;
  cardBookY: number;
};

type PendingAlbumDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  input: Omit<AlbumDragStart, 'event'>;
  startedOnMedia: boolean;
};

type BookDragSession = {
  pointerId: number;
  media: MediaRow;
  originalPlacement: AlbumPlacement;
  currentSpreadStart: number;
  cardWidth: number;
  cardHeight: number;
  grabOffsetX: number;
  grabOffsetY: number;
  cardBookX: number;
  cardBookY: number;
  edgeZone: -1 | 1 | null;
  edgeArmed: boolean;
  edgeTimer: ReturnType<typeof setTimeout> | null;
  proxy: HTMLDivElement;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isAlbumNoDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '.media-owner-menu, input, textarea, select, button, label, a[href], video[controls], [contenteditable="true"]'
    ) !== null
  );
}

function validClientPlacement(value: AlbumPlacement): AlbumPlacement | null {
  const pageIndex = Number(value.pageIndex);
  const x = Number(value.x);
  const y = Number(value.y);
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex > MAX_ALBUM_PAGE_INDEX ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    x > 1 ||
    y < 0 ||
    y > 1
  ) {
    return null;
  }
  return { pageIndex, x, y };
}

type PageBox = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

function pageBoxWithinBook(page: HTMLElement, book: HTMLElement): PageBox | null {
  const bookRect = book.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  if (
    book.clientWidth <= 0 ||
    book.clientHeight <= 0 ||
    bookRect.width <= 0 ||
    bookRect.height <= 0 ||
    page.clientWidth <= 0 ||
    page.clientHeight <= 0
  ) {
    return null;
  }

  const scaleX = book.clientWidth / bookRect.width;
  const scaleY = book.clientHeight / bookRect.height;
  return {
    // Absolute children use the page padding box as their containing block.
    // Include the border inset so MotionValue x/y and this book-space box
    // share the exact same origin.
    left: (pageRect.left - bookRect.left) * scaleX + page.clientLeft,
    top: (pageRect.top - bookRect.top) * scaleY + page.clientTop,
    width: page.clientWidth,
    height: page.clientHeight,
  };
}

function placementFromBookDrop(input: {
  spreadPageIndexes: readonly [number, number | null];
  bookWidth: number;
  bookHeight: number;
  leftPage: PageBox;
  rightPage: PageBox | null;
  cardWidth: number;
  cardHeight: number;
  cardBookX: number;
  cardBookY: number;
}): AlbumPlacement | null {
  const measurements = [
    input.bookWidth,
    input.bookHeight,
    input.leftPage.left,
    input.leftPage.top,
    input.leftPage.width,
    input.leftPage.height,
    input.cardWidth,
    input.cardHeight,
    input.cardBookX,
    input.cardBookY,
    ...(input.rightPage
      ? [input.rightPage.left, input.rightPage.top, input.rightPage.width, input.rightPage.height]
      : []),
  ];
  if (
    !measurements.every(Number.isFinite) ||
    input.bookWidth <= 0 ||
    input.bookHeight <= 0 ||
    input.leftPage.width <= 0 ||
    input.leftPage.height <= 0 ||
    input.cardWidth <= 0 ||
    input.cardHeight <= 0
  ) {
    return null;
  }

  const [leftPageIndex, rightPageIndex] = input.spreadPageIndexes;
  if (!Number.isInteger(leftPageIndex)) return null;
  const bookX = clamp(
    input.cardBookX,
    0,
    Math.max(0, input.bookWidth - input.cardWidth)
  );
  const bookY = clamp(input.cardBookY, 0, Math.max(0, input.bookHeight - input.cardHeight));
  const landsOnRight =
    rightPageIndex !== null &&
    input.rightPage !== null &&
    bookX + input.cardWidth / 2 >= input.bookWidth / 2;
  const destinationPageIndex = landsOnRight ? rightPageIndex : leftPageIndex;
  const destinationPage = landsOnRight ? input.rightPage : input.leftPage;
  if (!destinationPage || destinationPageIndex === null) return null;
  const maxX = Math.max(0, destinationPage.width - input.cardWidth);
  const maxY = Math.max(0, destinationPage.height - input.cardHeight);

  return validClientPlacement({
    pageIndex: destinationPageIndex,
    x: maxX > 0 ? clamp((bookX - destinationPage.left) / maxX, 0, 1) : 0.5,
    y: maxY > 0 ? clamp((bookY - destinationPage.top) / maxY, 0, 1) : 0.5,
  });
}

function resolveMediaUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return getMediaUrl(value);
}

function memoryTagFor(media: MediaRow | undefined): string | null {
  const trimmed = media?.memory_tag?.trim();
  return trimmed || null;
}

function captionFor(media: MediaRow, index: number): string {
  return media.caption?.trim() || `Photo ${index + 1}`;
}

/**
 * Produces balanced 2–3 item leaves whenever the album has at least two
 * items. A one-item loose album remains valid, while 4/5/7 items become
 * 2+2, 3+2, and 3+2+2 instead of leaving a visually empty one-photo tail.
 */
function balancedPageSizes(itemCount: number): number[] {
  if (itemCount <= 0) return [0];
  const pageCount = Math.ceil(itemCount / MAX_ITEMS_PER_PAGE);
  const baseSize = Math.floor(itemCount / pageCount);
  const remainder = itemCount % pageCount;
  return Array.from({ length: pageCount }, (_, index) => baseSize + (index < remainder ? 1 : 0));
}

function defaultPageIndex(itemIndex: number, itemCount: number): number {
  const sizes = balancedPageSizes(itemCount);
  let cursor = 0;
  for (let pageIndex = 0; pageIndex < sizes.length; pageIndex += 1) {
    cursor += sizes[pageIndex];
    if (itemIndex < cursor) return pageIndex;
  }
  return Math.max(0, sizes.length - 1);
}

const DEFAULT_SLOTS: Record<number, Array<{ x: number; y: number }>> = {
  1: [{ x: 0.5, y: 0.48 }],
  2: [
    { x: 0.04, y: 0.04 },
    { x: 0.96, y: 0.96 },
  ],
  3: [
    { x: 0.04, y: 0.04 },
    { x: 0.96, y: 0.04 },
    { x: 0.5, y: 0.96 },
  ],
};

/**
 * Stable semi-random layout: tactile jitter without hydration reshuffling.
 * The three anchors occupy two separated rows. Card sizing is capped by the
 * album CSS, and the deliberately small ±2.5% travel jitter preserves the
 * gap between their maximum bounding boxes instead of turning "randomness"
 * into an unreadable pile.
 */
function defaultPlacement(media: MediaRow, pageIndex: number, slotIndex: number, pageSize: number): AlbumPlacement {
  const slot = DEFAULT_SLOTS[pageSize]?.[slotIndex] ?? DEFAULT_SLOTS[1][0];
  const jitterX = ((hashString(`${media.id}:album-x`) % 1001) / 1000 - 0.5) * 0.05;
  const jitterY = ((hashString(`${media.id}:album-y`) % 1001) / 1000 - 0.5) * 0.05;
  return {
    pageIndex,
    x: clamp(slot.x + jitterX, 0, 1),
    y: clamp(slot.y + jitterY, 0, 1),
  };
}

function storedPlacement(media: MediaRow): AlbumPlacement | null {
  if (media.album_placement_initialized !== true) return null;

  // The deployed-name fields are authoritative. The 0004 aliases remain a
  // compatibility fallback while 0005 dual-writes both naming schemes.
  const pageIndex = media.album_page_number ?? media.album_page_index;
  const x = media.album_page_x ?? media.album_pos_x;
  const y = media.album_page_y ?? media.album_pos_y;
  if (
    pageIndex === null ||
    x === null ||
    y === null ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex > MAX_ALBUM_PAGE_INDEX ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }
  return {
    pageIndex,
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
  };
}

function leafCountThroughBlankSpread(highestUsedPageIndex: number): number {
  const occupiedSpreadStart =
    Math.floor(highestUsedPageIndex / PAGES_PER_SPREAD) * PAGES_PER_SPREAD;
  const trailingBlankSpreadEnd =
    occupiedSpreadStart + PAGES_PER_SPREAD * 2 - 1;
  return Math.min(MAX_ALBUM_PAGE_INDEX, trailingBlankSpreadEnd) + 1;
}

function randomUnit(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    return random[0] / 0x1_0000_0000;
  }
  return Math.random();
}

/**
 * Creates a genuinely random first position around a separated safe anchor.
 * X/Y remain normalized in storage, then AlbumMemoryCard maps them to the
 * measured pixel travel left after its true 210px card size is known.
 */
function randomInitialPlacement(
  pageIndex: number,
  slotIndex: number,
  pageSize: number
): AlbumPlacement {
  const slot = DEFAULT_SLOTS[pageSize]?.[slotIndex] ?? DEFAULT_SLOTS[1][0];
  const jitter = 0.045;
  return {
    pageIndex,
    x: clamp(slot.x + (randomUnit() - 0.5) * jitter, 0, 1),
    y: clamp(slot.y + (randomUnit() - 0.5) * jitter, 0, 1),
  };
}

function buildAlbumLeaves(
  mediaItems: MediaRow[],
  overrides: Record<string, AlbumPlacement>
): AlbumLeaf[] {
  const grouped = new Map<number, Array<Omit<PageEntry, 'placement'> & { placement: AlbumPlacement | null }>>();
  mediaItems.forEach((media, mediaIndex) => {
    const optimistic = Object.prototype.hasOwnProperty.call(overrides, media.id)
      ? overrides[media.id]
      : null;
    const saved = optimistic ?? storedPlacement(media);

    const pageIndex = saved?.pageIndex ?? defaultPageIndex(mediaIndex, mediaItems.length);
    const entry = { media, mediaIndex, placement: saved };
    const page = grouped.get(pageIndex);
    if (page) page.push(entry);
    else grouped.set(pageIndex, [entry]);
  });

  const highestUsedPageIndex = Math.max(...grouped.keys(), 0);
  // Always keep the complete spread after the last occupied spread empty.
  // Dropping onto either of those leaves makes it occupied, which naturally
  // extends the memoized leaf model by another blank spread on the same
  // optimistic render.
  const leafCount = leafCountThroughBlankSpread(highestUsedPageIndex);
  return Array.from({ length: leafCount }, (_, pageIndex) => {
    const pageEntries = grouped.get(pageIndex) ?? [];
    return {
      index: pageIndex,
      entries: pageEntries.map((entry, slotIndex) => ({
        ...entry,
        placement:
          entry.placement ?? defaultPlacement(entry.media, pageIndex, slotIndex, pageEntries.length),
      })),
    };
  });
}

function createInitialPlacementOverrides(mediaItems: MediaRow[]): Record<string, AlbumPlacement> {
  const leaves = buildAlbumLeaves(mediaItems, {});
  const initial: Record<string, AlbumPlacement> = {};

  leaves.forEach((leaf) => {
    leaf.entries.forEach((entry, slotIndex) => {
      if (entry.media.album_placement_initialized === true) return;
      initial[entry.media.id] = randomInitialPlacement(
        leaf.index,
        slotIndex,
        leaf.entries.length
      );
    });
  });

  return initial;
}

type AlbumMemoryCardProps = {
  entry: PageEntry;
  pageRef: RefObject<HTMLDivElement | null>;
  bookRef: RefObject<HTMLDivElement | null>;
  decorative: boolean;
  dragging: boolean;
  order: number;
  onDragStart?: (input: AlbumDragStart) => void;
  onCommit: (media: MediaRow, placement: AlbumPlacement) => Promise<SavedAlbumPlacement>;
  canManage: boolean;
  onCaptionChange?: (id: string, caption: string) => void;
  onMemoryTagChange?: (id: string, memoryTag: string | null) => void;
  onDelete?: (id: string) => void;
  onMediaOpen?: (media: MediaRow) => void;
};

function AlbumMemoryCard({
  entry,
  pageRef,
  bookRef,
  decorative,
  dragging,
  order,
  onDragStart,
  onCommit,
  canManage,
  onCaptionChange,
  onMemoryTagChange,
  onDelete,
  onMediaOpen,
}: AlbumMemoryCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const pendingDragRef = useRef<PendingAlbumDrag | null>(null);
  const suppressMediaClickRef = useRef(false);
  const [videoActive, setVideoActive] = useState(false);
  const { media, mediaIndex, placement } = entry;
  const caption = captionFor(media, mediaIndex);
  const source = media.thumbnail_url ?? (media.media_type === 'image' ? media.original_url : null);
  const videoSource = media.media_type === 'video' ? resolveMediaUrl(media.original_url) : null;
  const frame = useMemo(
    () => getPolaroidGeometry(media.width, media.height),
    [media.width, media.height]
  );
  // CSS owns the page geometry. These safe first-paint values prevent a
  // measurement callback from being required before photos are visible.
  const x = useMotionValue(placement.x * Math.max(0, 400 - frame.cardWidth));
  const y = useMotionValue(placement.y * Math.max(0, 520 - frame.cardHeight));

  const syncFromPlacement = useCallback(() => {
    const page = pageRef.current;
    const card = cardRef.current;
    if (!page || !card) return;
    if (
      page.clientWidth <= 0 ||
      page.clientHeight <= 0 ||
      card.offsetWidth <= 0 ||
      card.offsetHeight <= 0
    )
      return;
    const maxX = Math.max(0, page.clientWidth - card.offsetWidth);
    const maxY = Math.max(0, page.clientHeight - card.offsetHeight);
    x.set(placement.x * maxX);
    y.set(placement.y * maxY);
  }, [pageRef, placement.x, placement.y, x, y]);

  useLayoutEffect(() => {
    syncFromPlacement();
    const page = pageRef.current;
    const card = cardRef.current;
    if (!page || !card) return;
    const observer = new ResizeObserver(syncFromPlacement);
    observer.observe(page);
    observer.observe(card);
    return () => observer.disconnect();
  }, [pageRef, syncFromPlacement]);

  const nudge = useCallback(
    (deltaX: number, deltaY: number) => {
      void onCommit(media, {
        pageIndex: placement.pageIndex,
        x: clamp(placement.x + deltaX, 0, 1),
        y: clamp(placement.y + deltaY, 0, 1),
      }).catch(() => undefined);
    },
    [media, onCommit, placement]
  );

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    event.stopPropagation();
    if (
      decorative ||
      !onDragStart ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) return;
    const page = pageRef.current;
    const book = bookRef.current;
    const card = cardRef.current;
    if (!page || !book || !card || book.clientWidth <= 0 || book.clientHeight <= 0) return;
    const sourcePage = page.closest<HTMLElement>('.open-album-static-page');
    const sourcePageBox = sourcePage ? pageBoxWithinBook(sourcePage, book) : null;
    if (!sourcePageBox) return;
    card.setPointerCapture(event.pointerId);
    pendingDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startedOnMedia:
        event.target instanceof Element && event.target.closest('.open-album-memory-photo') !== null,
      input: {
        media,
        placement,
        card,
        cardBookX: sourcePageBox.left + x.get(),
        cardBookY: sourcePageBox.top + y.get(),
      },
    };
  }

  return (
    <motion.div
      ref={cardRef}
      className="open-album-memory-card"
      data-active={dragging}
      data-dragging={dragging || undefined}
      data-decorative={decorative}
      tabIndex={decorative ? -1 : 0}
      role={decorative ? undefined : 'group'}
      aria-roledescription={decorative ? undefined : 'draggable photo'}
      aria-label={
        decorative
          ? undefined
          : `${caption}. Drag to arrange on album page ${placement.pageIndex + 1}; cross the center spine to move it between visible pages.`
      }
      style={{
        x,
        y,
        width: frame.cardWidth,
        height: frame.cardHeight,
        rotate: rotationForId(`${media.id}:album`),
        zIndex: dragging ? 20 : order + 1,
      }}
      animate={{ scale: dragging ? 1.035 : 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (isAlbumNoDragTarget(event.target)) return;
        startDrag(event);
      }}
      onPointerMove={(event) => {
        const pending = pendingDragRef.current;
        if (!pending || pending.pointerId !== event.pointerId || !onDragStart) return;
        event.stopPropagation();
        if (
          Math.hypot(
            event.clientX - pending.startClientX,
            event.clientY - pending.startClientY
          ) < ALBUM_DRAG_SLOP_PX
        ) return;
        event.preventDefault();
        pendingDragRef.current = null;
        onDragStart({ event, ...pending.input });
      }}
      onPointerUp={(event) => {
        const pending = pendingDragRef.current;
        if (!pending || pending.pointerId !== event.pointerId) return;
        event.stopPropagation();
        pendingDragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (pending.startedOnMedia && media.media_type === 'video' && !videoActive) {
          suppressMediaClickRef.current = true;
          window.setTimeout(() => {
            suppressMediaClickRef.current = false;
          }, 0);
          setVideoActive(true);
        }
      }}
      onPointerCancel={(event) => {
        if (pendingDragRef.current?.pointerId === event.pointerId) pendingDragRef.current = null;
      }}
      onLostPointerCapture={(event) => {
        if (pendingDragRef.current?.pointerId === event.pointerId) pendingDragRef.current = null;
      }}
      onKeyDown={(event) => {
        if (decorative) return;
        const step = event.shiftKey ? KEYBOARD_NUDGE * 3 : KEYBOARD_NUDGE;
        const delta =
          event.key === 'ArrowLeft'
            ? { x: -step, y: 0 }
            : event.key === 'ArrowRight'
              ? { x: step, y: 0 }
              : event.key === 'ArrowUp'
                ? { x: 0, y: -step }
                : event.key === 'ArrowDown'
                  ? { x: 0, y: step }
                  : null;
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        nudge(delta.x, delta.y);
      }}
    >
      {!decorative ? (
        <MediaOwnerMenu
          media={media}
          canManage={canManage}
          onDetailsChanged={
            canManage && onCaptionChange && onMemoryTagChange
              ? (id, patch) => {
                  onCaptionChange(id, patch.caption);
                  onMemoryTagChange(id, patch.memoryTag);
                }
              : undefined
          }
          onDeleted={canManage ? onDelete : undefined}
          onViewFullscreen={onMediaOpen}
        />
      ) : null}
      <div
        className="open-album-memory-photo"
        data-media-type={media.media_type}
        data-video-active={videoActive || undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressMediaClickRef.current) return;
          if (media.media_type === 'video' && !videoActive) setVideoActive(true);
        }}
      >
        {videoSource && videoActive ? (
          <video
            src={videoSource}
            autoPlay
            controls
            muted={false}
            preload="metadata"
            playsInline
            aria-label={caption}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        ) : source ? (
          <Image
            src={resolveMediaUrl(source)}
            alt={decorative ? '' : caption}
            fill
            sizes={`${POLAROID_MEDIA_WIDTH_PX}px`}
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
        {media.media_type === 'video' && !videoActive ? (
          <span className="open-album-video-mark" aria-label="Video">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 7 8 5-8 5V7Z" fill="currentColor" />
            </svg>
          </span>
        ) : null}
        <PhotoContributor media={media} />
      </div>
      <p className="open-album-caption" dir="auto">{caption}</p>
    </motion.div>
  );
}

type AlbumPageProps = {
  leaf: AlbumLeaf | undefined;
  bookRef: RefObject<HTMLDivElement | null>;
  decorative?: boolean;
  draggedMediaId?: string | null;
  onDragStart?: (input: AlbumDragStart) => void;
  onCommit: (media: MediaRow, placement: AlbumPlacement) => Promise<SavedAlbumPlacement>;
  currentUserId?: string | null;
  onCaptionChange?: (id: string, caption: string) => void;
  onMemoryTagChange?: (id: string, memoryTag: string | null) => void;
  onDelete?: (id: string) => void;
  onMediaOpen?: (media: MediaRow) => void;
};

function AlbumPage({
  leaf,
  bookRef,
  decorative = false,
  draggedMediaId,
  onDragStart,
  onCommit,
  currentUserId,
  onCaptionChange,
  onMemoryTagChange,
  onDelete,
  onMediaOpen,
}: AlbumPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const pageIndex = leaf?.index ?? 0;
  const entries = leaf?.entries ?? [];

  return (
    <div
      ref={pageRef}
      className="open-album-page open-album-mini-corkboard"
      data-page-tone={pageIndex % 4}
      aria-label={decorative ? undefined : `Album page ${pageIndex + 1} with ${entries.length} photos`}
    >
      {entries.length === 0 ? <span className="open-album-page-flourish" aria-hidden="true" /> : null}
      {entries.map((entry, order) => (
        <AlbumMemoryCard
          key={entry.media.id}
          entry={entry}
          pageRef={pageRef}
          bookRef={bookRef}
          decorative={decorative}
          dragging={draggedMediaId === entry.media.id}
          order={order}
          onDragStart={onDragStart}
          onCommit={onCommit}
          canManage={currentUserId === entry.media.user_id}
          onCaptionChange={onCaptionChange}
          onMemoryTagChange={onMemoryTagChange}
          onDelete={onDelete}
          onMediaOpen={onMediaOpen}
        />
      ))}
      {leaf ? <span className="open-album-page-number" aria-hidden="true">{pageIndex + 1}</span> : null}
    </div>
  );
}

function OpenAlbumDialog({
  album,
  onClose,
  onPlacementChange,
  currentUserId,
  onCaptionChange,
  onMemoryTagChange,
  onDelete,
  onMediaOpen,
  initialPage = 0,
}: OpenAlbumProps) {
  const shouldReduceMotion = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const bookRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<BookDragSession | null>(null);
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const saveSequenceRef = useRef(0);
  const saveQueueRef = useRef(new Map<string, Promise<SavedAlbumPlacement>>());
  const saveVersionRef = useRef(new Map<string, number>());
  const placementOverridesRef = useRef<Record<string, AlbumPlacement>>({});
  const initialSaveStartedRef = useRef(false);
  // Normalized fallback positions are available during the first render, so
  // album pages never depend on ResizeObserver (or a resize event) to exist.
  // AlbumMemoryCard refines the pixel mapping after mount without hiding the
  // already-rendered content.
  const [initialPlacements] = useState<Record<string, AlbumPlacement>>(
    () => createInitialPlacementOverrides(album.items)
  );
  const [placementOverrides, setPlacementOverrides] = useState<Record<string, AlbumPlacement>>(
    initialPlacements
  );
  const [saveMessage, setSaveMessage] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const leaves = useMemo(
    () => buildAlbumLeaves(album.items, placementOverrides),
    [album.items, placementOverrides]
  );
  const lastSpreadStart = Math.max(0, Math.floor((leaves.length - 1) / 2) * 2);
  const safeInitialPage = clamp(Math.floor(initialPage), 0, Math.max(0, leaves.length - 1));
  const [spreadStart, setSpreadStart] = useState(Math.floor(safeInitialPage / 2) * 2);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const visibleSpreadStart = Math.min(spreadStart, lastSpreadStart);
  const turnRef = useRef<Turn | null>(turn);
  const visibleSpreadStartRef = useRef(visibleSpreadStart);
  const lastSpreadStartRef = useRef(lastSpreadStart);

  const title = memoryTagFor(album.items[0]) ?? 'Memory album';
  const canGoBack = visibleSpreadStart > 0 && !turn;
  const canGoForward = visibleSpreadStart < lastSpreadStart && !turn;

  useLayoutEffect(() => {
    placementOverridesRef.current = placementOverrides;
  }, [placementOverrides]);

  useLayoutEffect(() => {
    turnRef.current = turn;
    visibleSpreadStartRef.current = visibleSpreadStart;
    lastSpreadStartRef.current = lastSpreadStart;
  }, [lastSpreadStart, turn, visibleSpreadStart]);

  const commitPlacement = useCallback(async (
    media: MediaRow,
    placementInput: AlbumPlacement
  ): Promise<SavedAlbumPlacement> => {
    const placement = validClientPlacement(placementInput);
    if (!placement) {
      const validationError = new Error(
        'Invalid album drop geometry: page, x, and y must be finite page-relative values.'
      );
      console.error('updateAlbumPlacement blocked before request', {
        mediaId: media.id,
        placement: placementInput,
      });
      setSaveFailed(true);
      setSaveMessage(validationError.message);
      throw validationError;
    }

    const previousPlacement =
      placementOverridesRef.current[media.id] ??
      storedPlacement(media) ??
      placement;
    placementOverridesRef.current = {
      ...placementOverridesRef.current,
      [media.id]: placement,
    };
    setPlacementOverrides((current) => ({ ...current, [media.id]: placement }));
    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    const mediaVersion = (saveVersionRef.current.get(media.id) ?? 0) + 1;
    saveVersionRef.current.set(media.id, mediaVersion);
    setSaveFailed(false);
    setSaveMessage('Saving album arrangement…');

    // Serialize writes per photo so a slower earlier request can never land
    // after (and overwrite) a newer drag. The server action returns only
    // after Supabase has echoed and verified both deployed + alias columns.
    const previous = saveQueueRef.current.get(media.id);
    const pending = (previous ? previous.catch(() => undefined) : Promise.resolve())
      .then(async () => {
        const result = await updateAlbumPlacement(media.id, placement);
        if (!result.ok) {
          const diagnostic = [result.error.message, result.error.details, result.error.hint]
            .filter(Boolean)
            .join(' ');
          throw new Error(`[${result.error.code}] ${diagnostic}`);
        }
        return result.placement;
      });
    saveQueueRef.current.set(media.id, pending);

    try {
      const saved = await pending;
      const verified = { pageIndex: saved.pageIndex, x: saved.x, y: saved.y };
      if (saveVersionRef.current.get(media.id) === mediaVersion) {
        placementOverridesRef.current = {
          ...placementOverridesRef.current,
          [media.id]: verified,
        };
        setPlacementOverrides((current) => ({ ...current, [media.id]: verified }));
        // Patch the corkboard cache only after the database-returned row was
        // verified, so close/reopen cannot mistake a failed save for data.
        onPlacementChange?.(media.id, verified);
      }
      if (saveSequenceRef.current === sequence) {
        setSaveFailed(false);
        setSaveMessage('Album arrangement saved.');
      }
      return saved;
    } catch (error) {
      console.error('updateAlbumPlacement failed', error);
      if (saveVersionRef.current.get(media.id) === mediaVersion) {
        placementOverridesRef.current = {
          ...placementOverridesRef.current,
          [media.id]: previousPlacement,
        };
        setPlacementOverrides((current) => ({ ...current, [media.id]: previousPlacement }));
      }
      if (saveSequenceRef.current === sequence) {
        setSaveFailed(true);
        setSaveMessage(
          error instanceof Error
            ? error.message
            : 'Could not save this photo’s album position. Try again.'
        );
      }
      throw error;
    } finally {
      if (saveQueueRef.current.get(media.id) === pending) {
        saveQueueRef.current.delete(media.id);
      }
    }
  }, [onPlacementChange]);

  const requestTurn = useCallback((direction: -1 | 1, fromStart = visibleSpreadStartRef.current) => {
    if (turnRef.current) return null;
    const targetStart = fromStart + direction * PAGES_PER_SPREAD;
    if (targetStart < 0 || targetStart > lastSpreadStartRef.current) return null;

    if (shouldReduceMotion) {
      visibleSpreadStartRef.current = targetStart;
      setSpreadStart(targetStart);
      return targetStart;
    }
    const nextTurn = { direction, targetStart } as const;
    turnRef.current = nextTurn;
    setTurn(nextTurn);
    return targetStart;
  }, [shouldReduceMotion]);

  const placementForDrag = useCallback((session: BookDragSession, spread: number) => {
    const book = bookRef.current;
    if (!book || book.clientWidth <= 0 || book.clientHeight <= 0) return null;
    const leftElement = book.querySelector<HTMLElement>('.open-album-static-page-left');
    const rightElement = book.querySelector<HTMLElement>('.open-album-static-page-right');
    const leftPage = leftElement ? pageBoxWithinBook(leftElement, book) : null;
    const rightPage = rightElement ? pageBoxWithinBook(rightElement, book) : null;
    if (!leftPage) return null;

    return placementFromBookDrop({
      spreadPageIndexes: [spread, spread + 1],
      bookWidth: book.clientWidth,
      bookHeight: book.clientHeight,
      leftPage,
      rightPage,
      cardWidth: session.cardWidth,
      cardHeight: session.cardHeight,
      cardBookX: session.cardBookX,
      cardBookY: session.cardBookY,
    });
  }, []);

  const clearEdgeHover = useCallback((session: BookDragSession, resetZone = true) => {
    if (session.edgeTimer) clearTimeout(session.edgeTimer);
    session.edgeTimer = null;
    if (resetZone) {
      session.edgeZone = null;
      session.edgeArmed = true;
    }
    bookRef.current?.removeAttribute('data-drag-edge');
  }, []);

  const applyDragPlacement = useCallback((mediaId: string, placement: AlbumPlacement) => {
    placementOverridesRef.current = {
      ...placementOverridesRef.current,
      [mediaId]: placement,
    };
    setPlacementOverrides((current) => ({ ...current, [mediaId]: placement }));
  }, []);

  const armEdgeHover = useCallback((session: BookDragSession, direction: -1 | 1) => {
    const targetStart = session.currentSpreadStart + direction * PAGES_PER_SPREAD;
    if (
      !session.edgeArmed ||
      turnRef.current ||
      targetStart < 0 ||
      targetStart > lastSpreadStartRef.current
    ) return;

    session.edgeTimer = setTimeout(() => {
      session.edgeTimer = null;
      if (
        dragSessionRef.current !== session ||
        session.edgeZone !== direction ||
        !session.edgeArmed
      ) return;
      session.edgeArmed = false;
      bookRef.current?.removeAttribute('data-drag-edge');
      const requestedStart = requestTurn(direction, session.currentSpreadStart);
      if (requestedStart === null) return;
      session.currentSpreadStart = requestedStart;
      const provisional = placementForDrag(session, requestedStart);
      if (provisional) applyDragPlacement(session.media.id, provisional);
    }, EDGE_HOVER_DELAY_MS);
  }, [applyDragPlacement, placementForDrag, requestTurn]);

  const updateDragProxy = useCallback((session: BookDragSession) => {
    session.proxy.style.transform = `translate3d(${session.cardBookX}px, ${session.cardBookY}px, 0) rotate(${rotationForId(`${session.media.id}:album`)}deg) scale(1.035)`;
  }, []);

  const startBookDrag = useCallback((input: AlbumDragStart) => {
    const book = bookRef.current;
    if (
      !book ||
      dragSessionRef.current ||
      book.clientWidth <= 0 ||
      book.clientHeight <= 0
    ) return;
    const bookRect = book.getBoundingClientRect();
    if (bookRect.width <= 0 || bookRect.height <= 0) return;

    const proxy = input.card.cloneNode(true) as HTMLDivElement;
    proxy.querySelector('.media-owner-menu')?.remove();
    proxy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
    proxy.classList.add('open-album-drag-proxy');
    proxy.setAttribute('aria-hidden', 'true');
    proxy.removeAttribute('tabindex');
    proxy.dataset.active = 'true';
    proxy.dataset.dragging = 'true';
    book.append(proxy);

    const scaleX = book.clientWidth / bookRect.width;
    const scaleY = book.clientHeight / bookRect.height;
    const pointerBookX = (input.event.clientX - bookRect.left) * scaleX;
    const pointerBookY = (input.event.clientY - bookRect.top) * scaleY;
    const session: BookDragSession = {
      pointerId: input.event.pointerId,
      media: input.media,
      originalPlacement: input.placement,
      currentSpreadStart: visibleSpreadStartRef.current,
      cardWidth: input.card.offsetWidth,
      cardHeight: input.card.offsetHeight,
      grabOffsetX: pointerBookX - input.cardBookX,
      grabOffsetY: pointerBookY - input.cardBookY,
      cardBookX: input.cardBookX,
      cardBookY: input.cardBookY,
      edgeZone: null,
      edgeArmed: true,
      edgeTimer: null,
      proxy,
    };
    dragSessionRef.current = session;
    swipeStartRef.current = null;
    setDraggedMediaId(input.media.id);
    updateDragProxy(session);
    book.setPointerCapture(input.event.pointerId);
  }, [updateDragProxy]);

  const moveBookDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    const book = bookRef.current;
    if (!session || session.pointerId !== event.pointerId || !book) return false;
    event.preventDefault();
    event.stopPropagation();
    const bookRect = book.getBoundingClientRect();
    if (bookRect.width <= 0 || bookRect.height <= 0) return true;
    const scaleX = book.clientWidth / bookRect.width;
    const scaleY = book.clientHeight / bookRect.height;
    const pointerBookX = (event.clientX - bookRect.left) * scaleX;
    const pointerBookY = (event.clientY - bookRect.top) * scaleY;
    session.cardBookX = clamp(
      pointerBookX - session.grabOffsetX,
      0,
      Math.max(0, book.clientWidth - session.cardWidth)
    );
    session.cardBookY = clamp(
      pointerBookY - session.grabOffsetY,
      0,
      Math.max(0, book.clientHeight - session.cardHeight)
    );
    updateDragProxy(session);

    const edgeWidth = clamp(bookRect.width * 0.14, EDGE_ZONE_MIN_PX, EDGE_ZONE_MAX_PX);
    const insideBook =
      event.clientX >= bookRect.left && event.clientX <= bookRect.right &&
      event.clientY >= bookRect.top && event.clientY <= bookRect.bottom;
    const nextZone: -1 | 1 | null = !insideBook
      ? null
      : event.clientX <= bookRect.left + edgeWidth
        ? -1
        : event.clientX >= bookRect.right - edgeWidth
          ? 1
          : null;
    if (nextZone !== session.edgeZone) {
      clearEdgeHover(session);
      session.edgeZone = nextZone;
      if (nextZone !== null) {
        const targetStart = session.currentSpreadStart + nextZone * PAGES_PER_SPREAD;
        const canAutoTurn =
          !turnRef.current &&
          targetStart >= 0 &&
          targetStart <= lastSpreadStartRef.current;
        if (canAutoTurn) {
          book.dataset.dragEdge = nextZone === -1 ? 'previous' : 'next';
          armEdgeHover(session, nextZone);
        }
      }
    }
    return true;
  }, [armEdgeHover, clearEdgeHover, updateDragProxy]);

  const releaseBookDrag = useCallback((pointerId: number, persist: boolean) => {
    const session = dragSessionRef.current;
    const book = bookRef.current;
    if (!session || session.pointerId !== pointerId) return;
    const nextPlacement = persist
      ? placementForDrag(session, session.currentSpreadStart)
      : null;
    dragSessionRef.current = null;
    clearEdgeHover(session);
    session.proxy.remove();
    setDraggedMediaId(null);
    if (book?.hasPointerCapture(pointerId)) book.releasePointerCapture(pointerId);

    // Cross-spread hovering temporarily moves the card in local state so the
    // destination spread can render. Restore the true pre-drag value before
    // commitPlacement captures its rollback snapshot.
    applyDragPlacement(session.media.id, session.originalPlacement);
    if (!persist) return;
    if (!nextPlacement) {
      setSaveFailed(true);
      setSaveMessage('Could not resolve the destination album page. Try the drag again.');
      return;
    }
    void commitPlacement(session.media, nextPlacement).catch(() => undefined);
  }, [applyDragPlacement, clearEdgeHover, commitPlacement, placementForDrag]);

  useEffect(() => {
    if (initialSaveStartedRef.current || Object.keys(initialPlacements).length === 0) return;
    initialSaveStartedRef.current = true;

    // Queue outside the effect body so React Strict Mode can consume the ref
    // once before stateful save callbacks run. Each uninitialized row is
    // immediately persisted using the exact random placement already shown.
    queueMicrotask(() => {
      const mediaById = new Map(album.items.map((media) => [media.id, media]));
      void Promise.allSettled(
        Object.entries(initialPlacements).map(([mediaId, placement]) => {
          const media = mediaById.get(mediaId);
          return media ? commitPlacement(media, placement) : Promise.resolve(null);
        })
      );
    });
  }, [album.items, commitPlacement, initialPlacements]);

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

  useEffect(() => () => {
    const session = dragSessionRef.current;
    if (!session) return;
    if (session.edgeTimer) clearTimeout(session.edgeTimer);
    session.proxy.remove();
    dragSessionRef.current = null;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      // A focused card owns arrows for keyboard positioning.
      if (event.target instanceof Element && event.target.closest('.open-album-memory-card')) return;
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
        dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')
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

  const visibleLeafIndexes = useMemo(() => {
    const first = visibleSpreadStart + 1;
    const last = Math.min(leaves.length, visibleSpreadStart + 2);
    return first === last ? `${first}` : `${first}–${last}`;
  }, [leaves.length, visibleSpreadStart]);

  const visibleCaptions = leaves
    .slice(visibleSpreadStart, visibleSpreadStart + 2)
    .flatMap((leaf) => leaf.entries)
    .map((entry) => captionFor(entry.media, entry.mediaIndex))
    .join(', ');

  const baseLeftIndex = turn?.direction === -1 ? turn.targetStart : visibleSpreadStart;
  const baseRightIndex = turn?.direction === 1 ? turn.targetStart + 1 : visibleSpreadStart + 1;
  const sheetFrontIndex = turn?.direction === -1 ? turn.targetStart + 1 : visibleSpreadStart + 1;
  const sheetBackIndex = turn?.direction === -1 ? visibleSpreadStart : (turn?.targetStart ?? visibleSpreadStart);
  return (
    <section
      ref={dialogRef}
      className="open-album-overlay w-full max-w-full overflow-x-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="open-album-header w-full max-w-full px-1">
        <div className="open-album-heading-copy min-w-0">
          <p className="open-album-kicker">
            <Logo variant="mark" className="open-album-brand-mark" />
            <span>album</span>
          </p>
          <h2 id={titleId} dir="auto">{title}</h2>
          <p id={descriptionId}>{album.items.length} {album.items.length === 1 ? 'memory' : 'memories'}</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="open-album-close shrink-0 touch-manipulation"
          onClick={onClose}
          aria-label="Close album and return to the library"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
          <span>Back to library</span>
        </button>
      </div>

      <div className="open-album-stage w-full max-w-full">
        <button
          type="button"
          className="open-album-control open-album-control-previous touch-manipulation"
          onClick={() => requestTurn(-1)}
          disabled={!canGoBack}
          aria-label="Show previous album pages"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
          <span>Previous</span>
        </button>

        <div
          ref={bookRef}
          className="open-album-book max-md:[--album-mobile-logical-height:600px] max-md:[--album-mobile-logical-width:800px] max-md:origin-center"
          onPointerDown={(event) => {
            if (dragSessionRef.current) return;
            if (event.pointerType === 'mouse') return;
            swipeStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            moveBookDrag(event);
          }}
          onPointerUp={(event) => {
            if (dragSessionRef.current?.pointerId === event.pointerId) {
              event.preventDefault();
              event.stopPropagation();
              releaseBookDrag(event.pointerId, true);
              return;
            }
            const start = swipeStartRef.current;
            swipeStartRef.current = null;
            if (!start || start.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - start.x;
            const deltaY = event.clientY - start.y;
            if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY)) return;
            requestTurn(deltaX < 0 ? 1 : -1);
          }}
          onPointerCancel={(event) => {
            swipeStartRef.current = null;
            releaseBookDrag(event.pointerId, false);
          }}
          onPointerLeave={() => {
            const session = dragSessionRef.current;
            if (session) clearEdgeHover(session);
          }}
          onLostPointerCapture={(event) => {
            releaseBookDrag(event.pointerId, false);
          }}
        >
          <div className="open-album-book-shadow" aria-hidden="true" />
          <div className="open-album-cover-edge" aria-hidden="true">
            <span className="open-album-cover-grain" />
            <span className="open-album-cover-corner open-album-cover-corner-top-left" />
            <span className="open-album-cover-corner open-album-cover-corner-top-right" />
            <span className="open-album-cover-corner open-album-cover-corner-bottom-left" />
            <span className="open-album-cover-corner open-album-cover-corner-bottom-right" />
          </div>
          <div className="open-album-page-depth open-album-page-depth-left" aria-hidden="true" />
          <div className="open-album-page-depth open-album-page-depth-right" aria-hidden="true" />
          <div className="open-album-spine" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="open-album-binding" aria-hidden="true">
            <span className="open-album-binding-thread" />
          </div>
          <div className="open-album-pages">
            <div className="open-album-static-page open-album-static-page-left">
              <AlbumPage
                leaf={leaves[baseLeftIndex]}
                bookRef={bookRef}
                decorative={Boolean(turn)}
                draggedMediaId={draggedMediaId}
                onDragStart={startBookDrag}
                onCommit={commitPlacement}
                currentUserId={currentUserId}
                onCaptionChange={onCaptionChange}
                onMemoryTagChange={onMemoryTagChange}
                onDelete={onDelete}
                onMediaOpen={onMediaOpen}
              />
            </div>
            <div className="open-album-static-page open-album-static-page-right">
              <AlbumPage
                leaf={leaves[baseRightIndex]}
                bookRef={bookRef}
                decorative={Boolean(turn)}
                draggedMediaId={draggedMediaId}
                onDragStart={startBookDrag}
                onCommit={commitPlacement}
                currentUserId={currentUserId}
                onCaptionChange={onCaptionChange}
                onMemoryTagChange={onMemoryTagChange}
                onDelete={onDelete}
                onMediaOpen={onMediaOpen}
              />
            </div>
          </div>

          {turn ? (
            <motion.div
              key={`${visibleSpreadStart}-${turn.direction}`}
              className="open-album-turning-sheet"
              initial={{ rotateY: turn.direction === 1 ? 0 : -180 }}
              animate={{ rotateY: turn.direction === 1 ? -180 : 0 }}
              transition={{ type: 'spring', stiffness: 115, damping: 19, mass: 0.7 }}
              onAnimationComplete={() => {
                setSpreadStart(turn.targetStart);
                visibleSpreadStartRef.current = turn.targetStart;
                turnRef.current = null;
                setTurn(null);
              }}
              aria-hidden="true"
            >
              <div className="open-album-sheet-face open-album-sheet-front">
                <AlbumPage
                  leaf={leaves[sheetFrontIndex]}
                  bookRef={bookRef}
                  decorative
                  draggedMediaId={draggedMediaId}
                  onCommit={commitPlacement}
                />
              </div>
              <div className="open-album-sheet-face open-album-sheet-back">
                <AlbumPage
                  leaf={leaves[sheetBackIndex]}
                  bookRef={bookRef}
                  decorative
                  draggedMediaId={draggedMediaId}
                  onCommit={commitPlacement}
                />
              </div>
            </motion.div>
          ) : null}
        </div>

        <button
          type="button"
          className="open-album-control open-album-control-next touch-manipulation"
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

      <div className="open-album-progress max-w-full break-words px-2" aria-live="polite" aria-atomic="true">
        <span>Pages {visibleLeafIndexes} of {leaves.length}</span>
        {saveMessage ? (
          <span className="open-album-save-status" data-error={saveFailed || undefined}>
            {' · '}{saveMessage}
          </span>
        ) : null}
        <span className="open-album-sr-only">. {visibleCaptions}</span>
      </div>
      <p className="open-album-gesture-hint max-w-full break-words px-2" aria-hidden="true">
        Drag to arrange · hold at an outer edge to flip · swipe to flip
      </p>
    </section>
  );
}

/**
 * A controlled, full-viewport album experience. The corkboard owns which
 * album is open; this component owns page-turn and independent leaf layout.
 */
export function OpenAlbum(props: OpenAlbumProps) {
  return <OpenAlbumDialog key={props.album.id} {...props} />;
}

export default OpenAlbum;
