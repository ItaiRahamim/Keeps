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
  type RefObject,
} from 'react';
import type { MediaRow } from '@/lib/types';
import { getMediaUrl } from '@/lib/contracts';
import { updateAlbumPlacement, type AlbumPlacement } from '@/lib/media/actions';
import { hashString, rotationForId } from '../lib/deterministic';
import './open-album.css';

const MAX_ITEMS_PER_PAGE = 3;
const KEYBOARD_NUDGE = 0.035;
const MIN_MEDIA_ASPECT = 0.62;
const MAX_MEDIA_ASPECT = 1.9;
const MIN_CARD_WIDTH_PERCENT = 26;
const MAX_CARD_WIDTH_PERCENT = 38;
const MIN_FRAME_ASPECT = 0.5;
const MAX_FRAME_ASPECT = 1.32;
const EDGE_DWELL_MS = 420;
const EDGE_ZONE_RATIO = 0.13;
const EDGE_ZONE_MIN_PX = 28;
const EDGE_ZONE_MAX_PX = 58;
const TRANSFER_EDGE_INSET = 0.06;

type EdgeDirection = -1 | 1;

export type OpenAlbumData = {
  id: string;
  items: MediaRow[];
};

export type OpenAlbumProps = {
  album: OpenAlbumData;
  onClose: () => void;
  onPlacementChange?: (mediaId: string, placement: AlbumPlacement) => void;
  initialPage?: number;
  /** Optional Framer shared-layout identity supplied by the corkboard. */
  layoutId?: string;
};

type Turn = {
  direction: -1 | 1;
  targetStart: number;
};

type TransferFeedback = {
  pageIndex: number;
  direction: EdgeDirection;
  token: number;
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

type DragSession = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  edgeDirection: EdgeDirection | null;
  edgeArmed: boolean;
  edgeTimer: ReturnType<typeof setTimeout> | null;
};

type EdgeIntent = {
  direction: EdgeDirection;
  armed: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
 * Keeps malformed/missing metadata safe while letting portrait, square, and
 * landscape memories retain visibly different physical frame proportions.
 * Width never exceeds 38% of a page; CSS independently caps height at 44%,
 * so three default slots always remain viable even for extreme portraits.
 */
function albumFrameGeometry(media: MediaRow): { widthPercent: number; frameAspect: number } {
  const width = media.width;
  const height = media.height;
  const rawAspect =
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
      ? width / height
      : 1;
  const mediaAspect = clamp(rawAspect, MIN_MEDIA_ASPECT, MAX_MEDIA_ASPECT);
  const rangeProgress = (mediaAspect - MIN_MEDIA_ASPECT) / (MAX_MEDIA_ASPECT - MIN_MEDIA_ASPECT);

  return {
    widthPercent:
      MIN_CARD_WIDTH_PERCENT +
      rangeProgress * (MAX_CARD_WIDTH_PERCENT - MIN_CARD_WIDTH_PERCENT),
    // A Polaroid is slightly taller than its image to retain a caption chin.
    frameAspect: clamp(0.76 + (mediaAspect - 1) * 0.9, MIN_FRAME_ASPECT, MAX_FRAME_ASPECT),
  };
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

function storedPlacement(media: MediaRow, maxPageIndex: number): AlbumPlacement | null {
  const { album_page_index: pageIndex, album_pos_x: x, album_pos_y: y } = media;
  if (
    pageIndex === null ||
    x === null ||
    y === null ||
    !Number.isInteger(pageIndex) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }
  return {
    pageIndex: clamp(pageIndex, 0, maxPageIndex),
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
  };
}

function isLegacyOrigin(placement: AlbumPlacement): boolean {
  return placement.pageIndex === 0 && placement.x === 0 && placement.y === 0;
}

function buildAlbumLeaves(
  mediaItems: MediaRow[],
  overrides: Record<string, AlbumPlacement>
): AlbumLeaf[] {
  const defaultSizes = balancedPageSizes(mediaItems.length);
  // Two items is the minimum intended density, so this is the largest
  // sensible leaf index for the current album. It also prevents malformed
  // persisted data from allocating thousands of empty DOM pages.
  const maxPageIndex = Math.max(0, Math.ceil(mediaItems.length / 2) - 1);
  const grouped = new Map<number, Array<Omit<PageEntry, 'placement'> & { placement: AlbumPlacement | null }>>();
  let legacyOriginClaimed = false;

  mediaItems.forEach((media, mediaIndex) => {
    const optimistic = Object.prototype.hasOwnProperty.call(overrides, media.id)
      ? overrides[media.id]
      : null;
    let saved = optimistic ?? storedPlacement(media, maxPageIndex);

    // An early/legacy schema revision initialized every row to page 0 at
    // (0,0), which made an album render as one perfectly-overlapped card.
    // Keep the first origin as a legitimate exact persisted position, but
    // treat subsequent identical DB origins as unpositioned. They then flow
    // through balanced page assignment and the deterministic safe slots.
    // An in-session optimistic placement always wins, including an explicit
    // drag to the exact origin, so the UI never rewrites the user's gesture.
    if (!optimistic && saved && isLegacyOrigin(saved)) {
      if (legacyOriginClaimed) saved = null;
      else legacyOriginClaimed = true;
    }

    const pageIndex = saved?.pageIndex ?? defaultPageIndex(mediaIndex, mediaItems.length);
    const entry = { media, mediaIndex, placement: saved };
    const page = grouped.get(pageIndex);
    if (page) page.push(entry);
    else grouped.set(pageIndex, [entry]);
  });

  const leafCount = Math.max(defaultSizes.length - 1, ...grouped.keys(), 0) + 1;
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

type AlbumMemoryCardProps = {
  entry: PageEntry;
  pageRef: RefObject<HTMLDivElement | null>;
  decorative: boolean;
  active: boolean;
  order: number;
  maxPageIndex: number;
  onActiveChange: (id: string | null) => void;
  onCommit: (media: MediaRow, placement: AlbumPlacement) => void;
  onTransfer: (media: MediaRow, placement: AlbumPlacement, direction: EdgeDirection) => void;
};

function AlbumMemoryCard({
  entry,
  pageRef,
  decorative,
  active,
  order,
  maxPageIndex,
  onActiveChange,
  onCommit,
  onTransfer,
}: AlbumMemoryCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const [edgeIntent, setEdgeIntent] = useState<EdgeIntent | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const { media, mediaIndex, placement } = entry;
  const caption = captionFor(media, mediaIndex);
  const source = media.thumbnail_url ?? (media.media_type === 'image' ? media.original_url : null);
  const frame = useMemo(() => albumFrameGeometry(media), [media]);

  const syncFromPlacement = useCallback(() => {
    const page = pageRef.current;
    const card = cardRef.current;
    if (!page || !card) return;
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

  useEffect(
    () => () => {
      const timer = dragSessionRef.current?.edgeTimer;
      if (timer) clearTimeout(timer);
    },
    []
  );

  const updateEdgeIntent = useCallback(
    (clientX: number, pageRect: DOMRect) => {
      const session = dragSessionRef.current;
      if (!session) return;
      const edgeZone = clamp(pageRect.width * EDGE_ZONE_RATIO, EDGE_ZONE_MIN_PX, EDGE_ZONE_MAX_PX);
      const candidate: EdgeDirection | null =
        clientX <= pageRect.left + edgeZone && placement.pageIndex > 0
          ? -1
          : clientX >= pageRect.right - edgeZone && placement.pageIndex < maxPageIndex
            ? 1
            : null;

      if (candidate === session.edgeDirection) return;
      if (session.edgeTimer) clearTimeout(session.edgeTimer);
      session.edgeTimer = null;
      session.edgeDirection = candidate;
      session.edgeArmed = false;

      if (candidate === null) {
        setEdgeIntent(null);
        return;
      }

      setEdgeIntent({ direction: candidate, armed: false });
      session.edgeTimer = setTimeout(() => {
        const current = dragSessionRef.current;
        if (!current || current.pointerId !== session.pointerId || current.edgeDirection !== candidate) return;
        current.edgeArmed = true;
        current.edgeTimer = null;
        setEdgeIntent({ direction: candidate, armed: true });
      }, EDGE_DWELL_MS);
    },
    [maxPageIndex, placement.pageIndex]
  );

  const finishDrag = useCallback(
    (target: HTMLDivElement, pointerId: number, allowTransfer: boolean) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== pointerId) return;
      dragSessionRef.current = null;
      if (session.edgeTimer) clearTimeout(session.edgeTimer);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);

      const page = pageRef.current;
      const card = cardRef.current;
      if (!page || !card) return;
      const maxX = Math.max(0, page.clientWidth - card.offsetWidth);
      const maxY = Math.max(0, page.clientHeight - card.offsetHeight);
      const normalizedY = maxY > 0 ? clamp(y.get() / maxY, 0, 1) : 0.5;
      onActiveChange(null);
      setEdgeIntent(null);

      if (allowTransfer && session.edgeDirection !== null && session.edgeArmed) {
        onTransfer(
          media,
          {
            pageIndex: placement.pageIndex + session.edgeDirection,
            x: session.edgeDirection === 1 ? TRANSFER_EDGE_INSET : 1 - TRANSFER_EDGE_INSET,
            y: normalizedY,
          },
          session.edgeDirection
        );
        return;
      }

      onCommit(media, {
        pageIndex: placement.pageIndex,
        x: maxX > 0 ? clamp(x.get() / maxX, 0, 1) : 0.5,
        y: normalizedY,
      });
    },
    [media, onActiveChange, onCommit, onTransfer, pageRef, placement.pageIndex, x, y]
  );

  const nudge = useCallback(
    (deltaX: number, deltaY: number) => {
      onCommit(media, {
        pageIndex: placement.pageIndex,
        x: clamp(placement.x + deltaX, 0, 1),
        y: clamp(placement.y + deltaY, 0, 1),
      });
    },
    [media, onCommit, placement]
  );

  return (
    <motion.div
      ref={cardRef}
      className="open-album-memory-card"
      data-active={active}
      data-decorative={decorative}
      data-edge-intent={edgeIntent ? (edgeIntent.direction === -1 ? 'left' : 'right') : undefined}
      data-edge-armed={edgeIntent?.armed || undefined}
      tabIndex={decorative ? -1 : 0}
      role={decorative ? undefined : 'group'}
      aria-roledescription={decorative ? undefined : 'draggable photo'}
      aria-label={
        decorative
          ? undefined
          : `${caption}. Drag to arrange on album page ${placement.pageIndex + 1}; hold at an outer edge to move pages.`
      }
      style={{
        x,
        y,
        width: `${frame.widthPercent}%`,
        aspectRatio: frame.frameAspect,
        rotate: rotationForId(`${media.id}:album`),
        zIndex: active ? 20 : order + 1,
      }}
      animate={{ scale: active ? 1.035 : 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (decorative || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        const page = pageRef.current;
        const card = cardRef.current;
        if (!page || !card) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const pageRect = page.getBoundingClientRect();
        dragSessionRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          originX: x.get(),
          originY: y.get(),
          scaleX: page.clientWidth > 0 ? pageRect.width / page.clientWidth : 1,
          scaleY: page.clientHeight > 0 ? pageRect.height / page.clientHeight : 1,
          edgeDirection: null,
          edgeArmed: false,
          edgeTimer: null,
        };
        onActiveChange(media.id);
      }}
      onPointerMove={(event) => {
        const session = dragSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const page = pageRef.current;
        const card = cardRef.current;
        if (!page || !card) return;
        const maxX = Math.max(0, page.clientWidth - card.offsetWidth);
        const maxY = Math.max(0, page.clientHeight - card.offsetHeight);
        const pageRect = page.getBoundingClientRect();
        updateEdgeIntent(event.clientX, pageRect);
        x.set(
          clamp(
            session.originX + (event.clientX - session.startClientX) / Math.max(session.scaleX, 0.001),
            0,
            maxX
          )
        );
        y.set(
          clamp(
            session.originY + (event.clientY - session.startClientY) / Math.max(session.scaleY, 0.001),
            0,
            maxY
          )
        );
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        event.stopPropagation();
        finishDrag(event.currentTarget, event.pointerId, true);
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        finishDrag(event.currentTarget, event.pointerId, false);
      }}
      onLostPointerCapture={(event) => finishDrag(event.currentTarget, event.pointerId, false)}
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
      <div className="open-album-memory-photo">
        {source ? (
          <Image
            src={resolveMediaUrl(source)}
            alt={decorative ? '' : caption}
            fill
            sizes="(max-width: 760px) 22vw, 190px"
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
    </motion.div>
  );
}

type AlbumPageProps = {
  leaf: AlbumLeaf | undefined;
  decorative?: boolean;
  maxPageIndex: number;
  receivingDirection?: EdgeDirection | null;
  onCommit: (media: MediaRow, placement: AlbumPlacement) => void;
  onTransfer: (media: MediaRow, placement: AlbumPlacement, direction: EdgeDirection) => void;
};

function AlbumPage({
  leaf,
  decorative = false,
  maxPageIndex,
  receivingDirection = null,
  onCommit,
  onTransfer,
}: AlbumPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const pageIndex = leaf?.index ?? 0;
  const entries = leaf?.entries ?? [];

  return (
    <div
      ref={pageRef}
      className="open-album-page open-album-mini-corkboard"
      data-page-tone={pageIndex % 4}
      data-receiving={
        receivingDirection === null ? undefined : receivingDirection === -1 ? 'from-right' : 'from-left'
      }
      aria-label={decorative ? undefined : `Album page ${pageIndex + 1} with ${entries.length} photos`}
    >
      {entries.length === 0 ? <span className="open-album-page-flourish" aria-hidden="true" /> : null}
      {entries.map((entry, order) => (
        <AlbumMemoryCard
          key={entry.media.id}
          entry={entry}
          pageRef={pageRef}
          decorative={decorative}
          active={activeId === entry.media.id}
          order={order}
          maxPageIndex={maxPageIndex}
          onActiveChange={setActiveId}
          onCommit={onCommit}
          onTransfer={onTransfer}
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
  initialPage = 0,
  layoutId,
}: OpenAlbumProps) {
  const shouldReduceMotion = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const saveSequenceRef = useRef(0);
  const transferSequenceRef = useRef(0);
  const transferFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [placementOverrides, setPlacementOverrides] = useState<Record<string, AlbumPlacement>>({});
  const [saveMessage, setSaveMessage] = useState('');
  const leaves = useMemo(
    () => buildAlbumLeaves(album.items, placementOverrides),
    [album.items, placementOverrides]
  );
  const lastSpreadStart = Math.max(0, Math.floor((leaves.length - 1) / 2) * 2);
  const safeInitialPage = clamp(Math.floor(initialPage), 0, Math.max(0, leaves.length - 1));
  const [spreadStart, setSpreadStart] = useState(Math.floor(safeInitialPage / 2) * 2);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [transferFeedback, setTransferFeedback] = useState<TransferFeedback | null>(null);
  const visibleSpreadStart = Math.min(spreadStart, lastSpreadStart);

  const title = memoryTagFor(album.items[0]) ?? 'Memory album';
  const canGoBack = visibleSpreadStart > 0 && !turn;
  const canGoForward = visibleSpreadStart < lastSpreadStart && !turn;

  const commitPlacement = useCallback((media: MediaRow, placement: AlbumPlacement) => {
    setPlacementOverrides((current) => ({ ...current, [media.id]: placement }));
    onPlacementChange?.(media.id, placement);
    const sequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = sequence;
    setSaveMessage('Saving album arrangement…');
    updateAlbumPlacement(media.id, placement)
      .then(() => {
        if (saveSequenceRef.current === sequence) setSaveMessage('Album arrangement saved.');
      })
      .catch((error) => {
        console.error('updateAlbumPlacement failed', error);
        if (saveSequenceRef.current === sequence) {
          setSaveMessage('Could not save this photo’s album position.');
        }
      });
  }, [onPlacementChange]);

  const requestTurn = useCallback((direction: -1 | 1) => {
    if (turn) return;
    const targetStart = visibleSpreadStart + direction * 2;
    if (targetStart < 0 || targetStart > lastSpreadStart) return;

    if (shouldReduceMotion) {
      setSpreadStart(targetStart);
      return;
    }
    setTurn({ direction, targetStart });
  }, [lastSpreadStart, shouldReduceMotion, turn, visibleSpreadStart]);

  const commitTransfer = useCallback(
    (media: MediaRow, placement: AlbumPlacement, direction: EdgeDirection) => {
      const sourcePageIndex = placement.pageIndex - direction;
      const sourceLeaf = leaves[sourcePageIndex];
      const targetLeaf = leaves[placement.pageIndex];
      if (!sourceLeaf || !targetLeaf) return;

      // A full destination cannot accept a fourth card, and moving out of a
      // two-card source would otherwise leave a sparse single-photo page.
      // Swap the destination card nearest the shared edge in those cases so
      // both bounded corkboards retain their intended 2–3 photo density.
      const shouldSwap =
        targetLeaf.entries.length >= MAX_ITEMS_PER_PAGE ||
        (sourceLeaf.entries.length <= 2 && targetLeaf.entries.length > 0);
      if (shouldSwap) {
        const displaced = [...targetLeaf.entries].sort((a, b) =>
          direction === 1
            ? a.placement.x - b.placement.x
            : b.placement.x - a.placement.x
        )[0];
        if (displaced) {
          commitPlacement(displaced.media, {
            pageIndex: sourcePageIndex,
            x: direction === 1 ? 1 - TRANSFER_EDGE_INSET : TRANSFER_EDGE_INSET,
            y: displaced.placement.y,
          });
        }
      }

      commitPlacement(media, placement);

      transferSequenceRef.current += 1;
      const feedback = {
        pageIndex: placement.pageIndex,
        direction,
        token: transferSequenceRef.current,
      };
      setTransferFeedback(feedback);
      if (transferFeedbackTimerRef.current) clearTimeout(transferFeedbackTimerRef.current);
      transferFeedbackTimerRef.current = setTimeout(() => {
        setTransferFeedback((current) => (current?.token === feedback.token ? null : current));
        transferFeedbackTimerRef.current = null;
      }, 850);

      const targetSpreadStart = Math.floor(placement.pageIndex / 2) * 2;
      if (targetSpreadStart !== visibleSpreadStart) requestTurn(direction);
    },
    [commitPlacement, leaves, requestTurn, visibleSpreadStart]
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (transferFeedbackTimerRef.current) clearTimeout(transferFeedbackTimerRef.current);
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
          aria-label="Close album and return to the library"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
          <span>Back to library</span>
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
          <div className="open-album-static-page open-album-static-page-left">
            <AlbumPage
              leaf={leaves[baseLeftIndex]}
              decorative={Boolean(turn)}
              maxPageIndex={leaves.length - 1}
              receivingDirection={
                transferFeedback?.pageIndex === baseLeftIndex ? transferFeedback.direction : null
              }
              onCommit={commitPlacement}
              onTransfer={commitTransfer}
            />
          </div>
          <div className="open-album-static-page open-album-static-page-right">
            <AlbumPage
              leaf={leaves[baseRightIndex]}
              decorative={Boolean(turn)}
              maxPageIndex={leaves.length - 1}
              receivingDirection={
                transferFeedback?.pageIndex === baseRightIndex ? transferFeedback.direction : null
              }
              onCommit={commitPlacement}
              onTransfer={commitTransfer}
            />
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
                setTurn(null);
              }}
              aria-hidden="true"
            >
              <div className="open-album-sheet-face open-album-sheet-front">
                <AlbumPage
                  leaf={leaves[sheetFrontIndex]}
                  decorative
                  maxPageIndex={leaves.length - 1}
                  onCommit={commitPlacement}
                  onTransfer={commitTransfer}
                />
              </div>
              <div className="open-album-sheet-face open-album-sheet-back">
                <AlbumPage
                  leaf={leaves[sheetBackIndex]}
                  decorative
                  maxPageIndex={leaves.length - 1}
                  onCommit={commitPlacement}
                  onTransfer={commitTransfer}
                />
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
        <span>Pages {visibleLeafIndexes} of {leaves.length}</span>
        <span className="open-album-sr-only">. {visibleCaptions}</span>
      </div>
      <p className="open-album-gesture-hint" aria-hidden="true">
        Drag to arrange · hold at an outer edge to move pages · swipe to flip
      </p>
      <span className="open-album-sr-only" aria-live="polite" aria-atomic="true">{saveMessage}</span>
    </motion.section>
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
