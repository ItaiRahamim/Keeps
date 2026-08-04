'use client';

import Image from 'next/image';
import type { MediaRow } from '@/lib/types';
import { getMediaUrl } from '@/lib/contracts';
import Polaroid from '../polaroid/Polaroid';
import { hashString, pinColorForId, rotationForId } from '../lib/deterministic';
import './album-stack.css';

// Mirrors Polaroid.tsx's own (unexported) CARD_WIDTH. Duplicated rather than
// imported so this file doesn't need to add an export to Polaroid.tsx — that
// file's diffs are owned by a parallel agent doing iOS-specific fixes this
// pass, and a single shared layout constant is low-risk to keep in sync by
// hand (Polaroid.tsx is the source of truth; update this if that ever
// changes).
const CARD_WIDTH = 210;

// How many of the album's actual photos peek out from behind the cover
// card. AGENTS.md suggests "top 2-3" — 2 reads clearly as "a stack" without
// the peeking corners starting to overlap each other or spill past the
// cover card's own edges.
const MAX_PEEKS = 2;

function resolveMediaUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return getMediaUrl(value);
}

/**
 * Deterministic down-right offset (px) for the Nth peek card, derived from
 * that photo's own id — same "controlled randomness" approach as
 * `rotationForId`/`pinColorForId` (design-system.md §5): a pure hash of the
 * id, never `Math.random()`, so SSR and client hydration always agree and
 * the fan-out never reshuffles on re-render. `depth` (0 = card closest to
 * the cover) sets the base receding distance; the per-id hash only adds a
 * few px of jitter on top so the stack doesn't look mechanically uniform.
 */
function peekOffset(id: string, depth: number): { dx: number; dy: number } {
  const base = (depth + 1) * 9;
  const jitterX = (hashString(`${id}:peek-x`) % 7) - 3; // [-3, 3]
  const jitterY = (hashString(`${id}:peek-y`) % 7) - 3; // [-3, 3]
  return { dx: base + jitterX, dy: base + jitterY };
}

export type AlbumStackProps = {
  album: { id: string; items: MediaRow[] };
  boardScale: number;
  onTransformChange: (
    id: string,
    patch: Partial<Pick<MediaRow, 'pos_x' | 'pos_y' | 'rotation' | 'z_index'>>
  ) => void;
  onBringToFront: (id: string) => number;
  onCaptionChange?: (id: string, caption: string) => void;
  onOpen: (albumId: string) => void;
};

/**
 * A cluster of same-day/same-place photos (from `groupIntoAlbums`),
 * rendered as a fanned/offset stack of Polaroids rather than N separate
 * cards — design-system.md's "physical corkboard" object, extended to a
 * small pile of photos rather than a single one.
 *
 * Collapsed (default): the album's chronologically-first photo ("cover")
 * renders as a completely normal, fully-interactive `<Polaroid>` — same
 * drag/hover/caption/video behavior as any single card, positioned at its
 * own real `pos_x`/`pos_y` exactly like AGENTS.md asks ("use the
 * top/representative photo's own position for the stack's placement").
 * Behind it, up to `MAX_PEEKS` more of the album's *actual* photos render
 * as small non-interactive corners peeking out at deterministic
 * offsets/rotations, plus a round badge showing the total photo count.
 *
 * Activating either the cover or its count badge delegates the album id to
 * Corkboard. The stack deliberately does not own focused-view state: that
 * keeps the camera mounted at its exact pan/zoom transform while the
 * controlled OpenAlbum overlay is active.
 */
export default function AlbumStack({
  album,
  boardScale,
  onTransformChange,
  onBringToFront,
  onCaptionChange,
  onOpen,
}: AlbumStackProps) {
  const { items } = album;
  const cover = items[0];
  const peeks = items.slice(1, 1 + MAX_PEEKS);
  const count = items.length;

  return (
    <>
      {/* Rendered before the cover so equal z-index ties resolve in the
          cover's favor (later DOM = paints on top) — see background.css's
          `.corkboard-surface` stacking notes; no z-index arithmetic needed
          beyond matching the cover's own value. */}
      {peeks.map((photo, depth) => {
        const { dx, dy } = peekOffset(photo.id, depth);
        const thumbSrc = photo.thumbnail_url ? resolveMediaUrl(photo.thumbnail_url) : null;
        return (
          <div
            key={photo.id}
            className="album-stack-peek"
            style={{
              left: cover.pos_x + dx,
              top: cover.pos_y + dy,
              width: CARD_WIDTH,
              zIndex: cover.z_index,
              transform: `rotate(${rotationForId(photo.id)}deg)`,
            }}
            aria-hidden="true"
          >
            <div className="polaroid-body album-stack-peek-body">
              <div className="polaroid-media album-stack-peek-media">
                {thumbSrc ? (
                  <Image src={thumbSrc} alt="" fill sizes="220px" draggable={false} />
                ) : null}
              </div>
            </div>
          </div>
        );
      })}

      <Polaroid
        media={cover}
        layoutId={`album-${album.id}`}
        boardScale={boardScale}
        onTransformChange={onTransformChange}
        onBringToFront={onBringToFront}
        onCaptionChange={onCaptionChange}
        onActivate={() => onOpen(album.id)}
        activationLabel={`Open album with ${count} ${count === 1 ? 'memory' : 'memories'}`}
      />

      <button
        type="button"
        className="album-stack-badge"
        data-pin-color={pinColorForId(album.id)}
        style={{
          left: cover.pos_x + CARD_WIDTH - 16,
          top: cover.pos_y - 12,
          zIndex: cover.z_index + 1,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onOpen(album.id)}
        aria-label={`Open album with ${count} ${count === 1 ? 'memory' : 'memories'}`}
        title={`${count} memories — tap to open`}
      >
        {count}
      </button>
    </>
  );
}
