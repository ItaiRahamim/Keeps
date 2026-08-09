'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import type { MediaRow } from '@/lib/types';
import { getMediaUrl } from '@/lib/contracts';
import { updateCaption, updateMediaTransform } from '@/lib/media/actions';
import Pushpin from '../pushpin/Pushpin';
import {
  PIN_POSITION_TRANSFORM_ORIGIN,
  pinColorForId,
  pinPositionForId,
  rotationForId,
} from '../lib/deterministic';
import { CARD_WIGGLE_FRACTION, DRAG_TILT_DEG, PIN_WIGGLE_KEYFRAMES, WIGGLE_TRANSITION } from '../lib/motion';
import { positionFromPointerDelta, type DragPoint } from './drag-position';
import { getPolaroidGeometry, POLAROID_CARD_WIDTH_PX } from './sizing';
import { PhotoContributor } from '../corkboard/ContributorAttribution';
import MediaOwnerMenu from './MediaOwnerMenu';
import './polaroid.css';

const SPRING_TRANSITION = { type: 'spring' as const, stiffness: 300, damping: 28 };
const TAP_SLOP_PX = 5;

type DragSession = {
  pointerId: number;
  pointerStart: DragPoint;
  origin: DragPoint;
  scale: number;
  zIndex: number;
  moved: boolean;
};

export type BoardScaleSource = number | (() => number);

function readBoardScale(source: BoardScaleSource): number {
  const scale = typeof source === 'function' ? source() : source;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

// ASSUMPTION (integration note — flagging for the cross-agent pass):
// `uploader.ts`'s `uploadProcessedMedia` returns `originalUrl`/`thumbnailUrl`
// (not `originalKey`/`thumbnailKey`), and `createMedia`'s input type stores
// them verbatim as `original_url`/`thumbnail_url` on MediaRow. That strongly
// suggests these columns hold full public URLs already (matching
// PresignResponse's `publicUrl` field in contracts.ts), not bare R2 keys.
// We therefore use `media.original_url`/`media.thumbnail_url` as-is, and
// only run a value through `getMediaUrl` (bare-key -> URL) as a defensive
// fallback if it turns out *not* to already look like a URL. If the Backend
// agent's schema ends up storing bare keys instead, flip the condition below
// (or just always call `getMediaUrl`).
function resolveMediaUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return getMediaUrl(value);
}

function isPolaroidInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '.polaroid-chin[data-polaroid-interactive="true"], input, textarea, select, button, label, a[href], video[controls], [contenteditable="true"]'
    ) !== null
  );
}

export type PolaroidProps = {
  media: MediaRow;
  /**
   * Live corkboard zoom source used to convert viewport-pixel pointer deltas
   * into board coordinates. Corkboard passes a getter because its camera is
   * a MotionValue and can change without a React render. A number remains
   * accepted for unscaled/static consumers such as isolated previews.
   */
  boardScale: BoardScaleSource;
  onTransformChange: (
    id: string,
    patch: Partial<Pick<MediaRow, 'pos_x' | 'pos_y' | 'rotation' | 'z_index'>>
  ) => void;
  onBringToFront: (id: string) => number;
  onCaptionChange?: (id: string, caption: string) => void;
  /** Optional tap/keyboard action used when this card represents an album
   * stack. Framer's tap recognizer cancels after a drag, so moving the
   * Polaroid never accidentally opens the album on pointer-up. */
  onActivate?: () => void;
  activationLabel?: string;
  layoutId?: string;
  canManage?: boolean;
  onMemoryTagChange?: (id: string, memoryTag: string | null) => void;
  onDelete?: (id: string) => void;
};

export default function Polaroid({
  media,
  boardScale,
  onTransformChange,
  onBringToFront,
  onCaptionChange,
  onActivate,
  activationLabel,
  layoutId,
  canManage = false,
  onMemoryTagChange,
  onDelete,
}: PolaroidProps) {
  const shouldReduceMotion = useReducedMotion();
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(media.caption ?? '');

  // These MotionValues hold the *absolute* board position, rather than a
  // temporary offset layered on top of left/top. That removes the old
  // release-time race where the offset was reset before React committed the
  // matching left/top state, which made a card visibly jump or fly away.
  const x = useMotionValue(media.pos_x);
  const y = useMotionValue(media.pos_y);
  const dragSessionRef = useRef<DragSession | null>(null);

  // Keep server/realtime/optimistic updates reflected when this card is not
  // under the pointer. During a drag, the pointer session is authoritative.
  useLayoutEffect(() => {
    if (dragSessionRef.current) return;
    x.set(media.pos_x);
    y.set(media.pos_y);
  }, [media.pos_x, media.pos_y, x, y]);

  // design-system.md §5 — a pure function of `id`, identical on server and
  // client. Deliberately NOT read from `media.rotation`: that DB column is
  // still kept in sync (see UploadSheet.tsx) for any other consumer, but
  // Polaroid itself never trusts it for what gets painted, so a card's tilt
  // can never disagree between SSR and hydration regardless of how that
  // column ends up populated.
  const baseRotation = useMemo(() => rotationForId(media.id), [media.id]);
  const pinColor = useMemo(() => pinColorForId(media.id), [media.id]);
  const pinPosition = useMemo(() => pinPositionForId(media.id), [media.id]);
  const transformOrigin = PIN_POSITION_TRANSFORM_ORIGIN[pinPosition];

  const geometry = useMemo(
    () => getPolaroidGeometry(media.width, media.height),
    [media.width, media.height]
  );

  // `.polaroid-media` gets its height from CSS `aspect-ratio` (set via the
  // inline style below) with no other in-flow content to size it from.
  // `aspect-ratio` is unsupported on iOS/iPadOS Safari < 15.4 — on those
  // engines the declaration is simply ignored, `.polaroid-media` has no
  // other height source, and it collapses to 0, taking the `fill`-mode
  // <Image> down with it (0×N boxes render nothing). Rather than relying on
  // feature support, compute the same result as an explicit pixel height
  // here — plain `height` in px needs no feature detection and works
  // identically on every browser back to CSS1, so it removes this failure
  // mode entirely rather than just narrowing the affected browser range.
  const playWiggle = isHovered && !shouldReduceMotion;
  const rotateTarget = shouldReduceMotion
    ? baseRotation
    : playWiggle
      ? PIN_WIGGLE_KEYFRAMES.map((deg) => baseRotation + deg * CARD_WIGGLE_FRACTION)
      : baseRotation + (isDragging ? DRAG_TILT_DEG : 0);

  const thumbSrc = media.thumbnail_url ? resolveMediaUrl(media.thumbnail_url) : null;
  const videoSrc = media.media_type === 'video' ? resolveMediaUrl(media.original_url) : null;

  function commitCaption() {
    setIsEditingCaption(false);
    const trimmed = captionDraft.trim();
    if (trimmed === (media.caption ?? '')) return;
    onCaptionChange?.(media.id, trimmed);
    updateCaption(media.id, trimmed).catch((err) => {
      console.error('updateCaption failed', err);
    });
  }

  function finishDrag(pointerId: number, card: HTMLDivElement, activateIfTap = false) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== pointerId) return;

    dragSessionRef.current = null;
    setIsDragging(false);
    if (card.hasPointerCapture(pointerId)) card.releasePointerCapture(pointerId);

    // x/y already contain the exact board-space values painted on screen.
    // Persist them without resetting or rebasing any transform, so pointer-up
    // cannot introduce a one-frame snap and no inertia can continue afterward.
    const pos_x = x.get();
    const pos_y = y.get();
    const patch = { pos_x, pos_y, z_index: session.zIndex };
    onTransformChange(media.id, patch);
    updateMediaTransform(media.id, patch).catch((err) => {
      console.error('updateMediaTransform failed', err);
    });

    if (activateIfTap && !session.moved) onActivate?.();
  }

  return (
    <motion.div
      layoutId={layoutId}
      className="polaroid-card"
      data-dragging={isDragging}
      data-activatable={onActivate ? 'true' : undefined}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? activationLabel : undefined}
      style={{
        left: 0,
        top: 0,
        width: POLAROID_CARD_WIDTH_PX,
        zIndex: media.z_index,
        x,
        y,
        transformOrigin,
      }}
      animate={{ rotate: rotateTarget }}
      transition={playWiggle ? WIGGLE_TRANSITION : SPRING_TRANSITION}
      // A card owns its pointer for the entire gesture. Native pointer
      // capture plus `touch-action: none` gives us exact, synchronous deltas
      // on iOS without allowing the delegated board handler to pan as well.
      onPointerDown={(event) => {
        // Native form/edit controls must receive their untouched pointer
        // sequence so Safari can focus them and place the text caret. This
        // guard intentionally runs before stopPropagation and pointer capture.
        if (isPolaroidInteractiveTarget(event.target)) return;
        event.stopPropagation();
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (dragSessionRef.current) return;

        const zIndex = onBringToFront(media.id);
        const pointerStart = { x: event.clientX, y: event.clientY };
        dragSessionRef.current = {
          pointerId: event.pointerId,
          pointerStart,
          origin: { x: x.get(), y: y.get() },
          // Sample the live camera once at pointer-down. This avoids stale
          // render-time numbers while keeping one coordinate system for the
          // complete gesture.
          scale: readBoardScale(boardScale),
          zIndex,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
        onTransformChange(media.id, { z_index: zIndex });
      }}
      onPointerMove={(event) => {
        const session = dragSessionRef.current;
        if (!session || session.pointerId !== event.pointerId) return;
        event.stopPropagation();
        event.preventDefault();

        const pointerCurrent = { x: event.clientX, y: event.clientY };
        if (
          !session.moved &&
          Math.hypot(
            pointerCurrent.x - session.pointerStart.x,
            pointerCurrent.y - session.pointerStart.y
          ) >= TAP_SLOP_PX
        ) {
          session.moved = true;
        }
        const next = positionFromPointerDelta(
          session.origin,
          session.pointerStart,
          pointerCurrent,
          session.scale
        );
        x.set(next.x);
        y.set(next.y);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        finishDrag(event.pointerId, event.currentTarget, true);
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        finishDrag(event.pointerId, event.currentTarget);
      }}
      onLostPointerCapture={(event) => {
        event.stopPropagation();
        finishDrag(event.pointerId, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (
          !onActivate ||
          event.target !== event.currentTarget ||
          (event.key !== 'Enter' && event.key !== ' ')
        )
          return;
        event.preventDefault();
        onActivate();
      }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
    >
      <Pushpin color={pinColor} position={pinPosition} hovered={playWiggle} />

      {canManage && onMemoryTagChange && onDelete ? (
        <MediaOwnerMenu
          mediaId={media.id}
          memoryTag={media.memory_tag}
          onMoved={onMemoryTagChange}
          onDeleted={onDelete}
        />
      ) : null}

      <div className="polaroid-body">
        <div
          className="polaroid-media"
          style={{ aspectRatio: `${geometry.mediaAspect}`, height: geometry.mediaHeight }}
          onClick={() => {
            if (onActivate) return;
            if (media.media_type === 'video' && !videoActive) setVideoActive(true);
          }}
        >
          {thumbSrc ? (
            <Image
              src={thumbSrc}
              alt={media.caption || 'Family photo'}
              fill
              sizes="220px"
              placeholder={media.thumbnail_data ? 'blur' : 'empty'}
              blurDataURL={media.thumbnail_data ?? undefined}
              draggable={false}
              style={{ opacity: videoActive ? 0 : 1, transition: 'opacity 200ms ease' }}
            />
          ) : null}

          {/* Video-in-Polaroid (design-system.md §8): the thumbnail
              crossfades into a borderless <video> filling the identical
              media region on tap. The outer frame never resizes/reflows —
              only this innermost layer swaps, and the <video> is lazily
              mounted only once activated so nothing loads/plays before the
              user asks for it. */}
          {media.media_type === 'video' && videoSrc && videoActive ? (
            <video
              src={videoSrc}
              autoPlay
              loop
              muted
              // Required for iOS inline playback — without it iOS forces a
              // fullscreen takeover, which breaks the "plays inside the
              // frame" requirement. Easy to miss; do not remove.
              playsInline
              style={{ opacity: 1, transition: 'opacity 200ms ease' }}
            />
          ) : null}

          {media.media_type === 'video' && !videoActive ? (
            <div className="polaroid-play-badge">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.35)" />
                <path d="M9.5 7.5v9l8-4.5-8-4.5z" fill="white" />
              </svg>
            </div>
          ) : null}

          <PhotoContributor media={media} />
        </div>

        <div
          className="polaroid-chin"
          data-polaroid-interactive={!onActivate ? 'true' : undefined}
          onPointerDown={(event) => {
            if (!onActivate) event.stopPropagation();
          }}
          onPointerUp={(event) => {
            if (!onActivate) event.stopPropagation();
          }}
          onClick={(event) => {
            if (!onActivate) event.stopPropagation();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (!onActivate) setIsEditingCaption(true);
          }}
        >
          {isEditingCaption ? (
            <input
              autoFocus
              className="polaroid-chin-input"
              value={captionDraft}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onBlur={commitCaption}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setCaptionDraft(media.caption ?? '');
                  setIsEditingCaption(false);
                }
              }}
            />
          ) : media.caption ? (
            <span>{media.caption}</span>
          ) : (
            <span className="polaroid-chin-placeholder">double-tap to caption</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
