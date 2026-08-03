'use client';

import { useMemo, useRef, useState } from 'react';
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
import './polaroid.css';

const CARD_WIDTH = 210;
const MIN_ASPECT = 0.68;
const MAX_ASPECT = 1.45;
// `.polaroid-body`'s asymmetric padding (design-system.md §3) is
// `12px 12px 56px 12px` and box-sizing: border-box, so `.polaroid-media`'s
// actual content width is CARD_WIDTH minus the 12px left + 12px right
// padding. Used below to compute an explicit pixel height as a fallback for
// `aspect-ratio` (see MEDIA_MIN_HEIGHT_PX comment).
const MEDIA_CONTENT_WIDTH = CARD_WIDTH - 24;
const SPRING_TRANSITION = { type: 'spring' as const, stiffness: 300, damping: 28 };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
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

export type PolaroidProps = {
  media: MediaRow;
  /** Current corkboard zoom level — needed to convert Framer Motion's
   *  screen-space drag offset back into the board's own (scaled) coordinate
   *  space before persisting pos_x/pos_y. */
  boardScale: number;
  onTransformChange: (
    id: string,
    patch: Partial<Pick<MediaRow, 'pos_x' | 'pos_y' | 'rotation' | 'z_index'>>
  ) => void;
  onBringToFront: (id: string) => number;
  onCaptionChange?: (id: string, caption: string) => void;
};

export default function Polaroid({
  media,
  boardScale,
  onTransformChange,
  onBringToFront,
  onCaptionChange,
}: PolaroidProps) {
  const shouldReduceMotion = useReducedMotion();
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  const [isEditingCaption, setIsEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(media.caption ?? '');

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const dragOriginRef = useRef({ pos_x: media.pos_x, pos_y: media.pos_y, z_index: media.z_index });

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

  const aspect = useMemo(() => {
    if (!media.width || !media.height) return 1;
    return clamp(media.width / media.height, MIN_ASPECT, MAX_ASPECT);
  }, [media.width, media.height]);

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
  const mediaHeight = useMemo(() => MEDIA_CONTENT_WIDTH / aspect, [aspect]);

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

  return (
    <motion.div
      className="polaroid-card"
      data-dragging={isDragging}
      style={{
        left: media.pos_x,
        top: media.pos_y,
        width: CARD_WIDTH,
        zIndex: media.z_index,
        x,
        y,
        transformOrigin,
      }}
      animate={{ rotate: rotateTarget }}
      transition={playWiggle ? WIGGLE_TRANSITION : SPRING_TRANSITION}
      drag
      dragMomentum
      dragElastic={0.06}
      dragTransition={{ power: 0.2, timeConstant: 240, restDelta: 0.5 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onDragStart={() => {
        setIsDragging(true);
        const z = onBringToFront(media.id);
        dragOriginRef.current = { pos_x: media.pos_x, pos_y: media.pos_y, z_index: z };
        onTransformChange(media.id, { z_index: z });
      }}
      onDragEnd={() => {
        setIsDragging(false);
        const origin = dragOriginRef.current;
        // Framer's x/y motion values track raw screen-pixel offset; divide
        // by the board's current zoom to get the equivalent offset in the
        // (scaled) board coordinate space pos_x/pos_y live in.
        const pos_x = origin.pos_x + x.get() / boardScale;
        const pos_y = origin.pos_y + y.get() / boardScale;
        x.set(0);
        y.set(0);
        onTransformChange(media.id, { pos_x, pos_y, z_index: origin.z_index });
        updateMediaTransform(media.id, { pos_x, pos_y, z_index: origin.z_index }).catch((err) => {
          console.error('updateMediaTransform failed', err);
        });
      }}
    >
      <Pushpin color={pinColor} position={pinPosition} hovered={playWiggle} />

      <div className="polaroid-body">
        <div
          className="polaroid-media"
          style={{ aspectRatio: `${aspect}`, height: mediaHeight }}
          onClick={() => {
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
        </div>

        <div className="polaroid-chin" onDoubleClick={() => setIsEditingCaption(true)}>
          {isEditingCaption ? (
            <input
              autoFocus
              className="polaroid-chin-input"
              value={captionDraft}
              onChange={(e) => setCaptionDraft(e.target.value)}
              onBlur={commitCaption}
              onKeyDown={(e) => {
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
