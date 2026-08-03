'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClusterRow, MediaRow } from '@/lib/types';
import Polaroid from '../polaroid/Polaroid';
import UploadSheet from '../upload/UploadSheet';
import './background.css';

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
// Large enough to comfortably fit "dozens to low hundreds" of cards without
// feeling cramped; not a hard limit — pos_x/pos_y are just coordinates
// within this surface, panning still works past its nominal edges.
const SURFACE_SIZE = 4000;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export type CorkboardProps = {
  media: MediaRow[];
  clusters: ClusterRow[];
};

/**
 * The pannable/zoomable board surface (design-system.md §2), owner of the
 * media items' live (optimistic) layout state, and — per the task's
 * composition note — the mount point for the upload FAB/modal. `page.tsx`
 * (a Server Component) can't hold client state itself, so this client
 * component is what actually wires "new upload -> appears on the board"
 * together; page.tsx just hands it the initial server-fetched rows.
 */
export default function Corkboard({ media, clusters }: CorkboardProps) {
  // Not yet surfaced in this pass — reserved for a future cluster/album
  // view. Destructured here (not dropped) so the prop stays part of the
  // component's public contract against `getClusters()`.
  void clusters;

  const [items, setItems] = useState<MediaRow[]>(media);
  const zCounterRef = useRef(items.reduce((max, item) => Math.max(max, item.z_index), 0));

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const panOriginRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null
  );
  const [isPanning, setIsPanning] = useState(false);

  // Wheel/trackpad zoom. Must be a non-passive *native* listener: React
  // attaches `onWheel` as a passive listener by default, so
  // `e.preventDefault()` inside a synthetic onWheel handler is silently
  // ignored (and warns) — it would never stop the page itself from
  // scrolling while zooming the board.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => clamp(s * Math.exp(-e.deltaY * 0.001), MIN_SCALE, MAX_SCALE));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Pan by dragging the empty board background. Deliberately plain pointer
  // events (not Framer Motion's `drag`) so it never fights with each
  // Polaroid's own independent drag gesture: we only start a pan when the
  // pointerdown target *is* the viewport itself, not a bubbled event from a
  // card (or its pin) sitting on top of it.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      panOriginRef.current = { startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y };
      setIsPanning(true);
    },
    [pan.x, pan.y]
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const origin = panOriginRef.current;
    if (!origin) return;
    setPan({ x: origin.originX + (e.clientX - origin.startX), y: origin.originY + (e.clientY - origin.startY) });
  }, []);

  const handlePointerUp = useCallback(() => {
    panOriginRef.current = null;
    setIsPanning(false);
  }, []);

  const handleTransformChange = useCallback(
    (id: string, patch: Partial<Pick<MediaRow, 'pos_x' | 'pos_y' | 'rotation' | 'z_index'>>) => {
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    },
    []
  );

  const handleCaptionChange = useCallback((id: string, caption: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, caption } : item)));
  }, []);

  const handleBringToFront = useCallback(() => {
    zCounterRef.current += 1;
    return zCounterRef.current;
  }, []);

  const handleCreated = useCallback((row: MediaRow) => {
    setItems((prev) => [...prev, row]);
    zCounterRef.current = Math.max(zCounterRef.current, row.z_index);
  }, []);

  // Reasonable initial drop spot for a newly uploaded item: roughly the
  // center of what's currently visible, translated from screen space into
  // the surface's own (pannable/zoomable) coordinate space, with a little
  // jitter so consecutive uploads don't stack exactly on top of each other.
  // This is an ephemeral interactive placement decision (not part of any
  // SSR-rendered output), so plain `Math.random()` here is fine — it's not
  // subject to the determinism requirement in design-system.md §5, which is
  // specifically about a card's *tilt*.
  const getDropPosition = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const vw = rect?.width ?? 800;
    const vh = rect?.height ?? 600;
    const centerX = (vw / 2 - pan.x) / scale;
    const centerY = (vh / 2 - pan.y) / scale;
    const jitter = () => (Math.random() - 0.5) * 160;
    return { x: centerX + jitter(), y: centerY + jitter() };
  }, [pan.x, pan.y, scale]);

  const surfaceTransform = useMemo(
    () => `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
    [pan.x, pan.y, scale]
  );

  return (
    <div
      ref={viewportRef}
      className="corkboard-viewport cork-texture"
      data-panning={isPanning}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="corkboard-surface"
        style={{ transform: surfaceTransform, width: SURFACE_SIZE, height: SURFACE_SIZE }}
      >
        {items.map((item) => (
          <Polaroid
            key={item.id}
            media={item}
            boardScale={scale}
            onTransformChange={handleTransformChange}
            onBringToFront={handleBringToFront}
            onCaptionChange={handleCaptionChange}
          />
        ))}
      </div>

      {items.length === 0 ? (
        <div className="corkboard-empty-state">
          <div className="corkboard-empty-state-card">
            <p className="corkboard-empty-state-title">The board is empty</p>
            <p className="corkboard-empty-state-subtitle">Tap the + button to pin your first photo or video.</p>
          </div>
        </div>
      ) : null}

      <UploadSheet onCreated={handleCreated} getDropPosition={getDropPosition} />
    </div>
  );
}
