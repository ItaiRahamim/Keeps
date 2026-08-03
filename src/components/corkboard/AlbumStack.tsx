'use client';

import { useState } from 'react';
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
 * Expanded (tap the badge): every photo in the album renders as its own
 * ordinary `<Polaroid>` at *its own* stored `pos_x`/`pos_y` — i.e. exactly
 * where it would already sit on the board if clustering didn't exist. This
 * was chosen over fanning items out to synthetic temporary coordinates
 * because Polaroid's drag-end handler persists `pos_x`/`pos_y` back to the
 * DB from whatever position it was initially given; feeding it a fake,
 * stack-local position would silently overwrite a photo's real board
 * position with a throwaway layout coordinate the first time someone drags
 * an expanded card. Revealing true positions has no such failure mode and
 * keeps every card's drag-to-reposition behavior identical to a plain
 * single, expanded or not. A small pill at the cover's old spot collapses
 * the album back into a stack.
 */
export default function AlbumStack({ album, boardScale, onTransformChange, onBringToFront, onCaptionChange }: AlbumStackProps) {
  const [expanded, setExpanded] = useState(false);
  const { items } = album;
  const cover = items[0];
  const peeks = items.slice(1, 1 + MAX_PEEKS);
  const count = items.length;

  if (expanded) {
    const maxZ = items.reduce((max, item) => Math.max(max, item.z_index), cover.z_index);
    return (
      <>
        {items.map((item) => (
          <Polaroid
            key={item.id}
            media={item}
            boardScale={boardScale}
            onTransformChange={onTransformChange}
            onBringToFront={onBringToFront}
            onCaptionChange={onCaptionChange}
          />
        ))}
        <button
          type="button"
          className="album-stack-collapse"
          style={{ left: cover.pos_x, top: cover.pos_y, zIndex: maxZ + 1 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setExpanded(false)}
        >
          Collapse {count} photos
        </button>
      </>
    );
  }

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
        boardScale={boardScale}
        onTransformChange={onTransformChange}
        onBringToFront={onBringToFront}
        onCaptionChange={onCaptionChange}
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
        onClick={() => setExpanded(true)}
        aria-label={`Show all ${count} photos in this album`}
        title={`${count} photos — tap to expand`}
      >
        {count}
      </button>
    </>
  );
}
