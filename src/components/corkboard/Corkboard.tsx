'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValue } from 'framer-motion';
import type { ClusterRow, MediaRow } from '@/lib/types';
import type { AlbumPlacement } from '@/lib/media/actions';
import { getTaggedDropPosition, groupIntoAlbums } from '@/lib/media/clustering';
import Polaroid from '../polaroid/Polaroid';
import OpenAlbum from './OpenAlbum';
import UploadSheet from '../upload/UploadSheet';
import LibraryView, { ViewModeToggle, type LibraryAlbum, type ViewMode } from './LibraryView';
import './background.css';

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
// Large enough to comfortably fit "dozens to low hundreds" of cards without
// feeling cramped. This is also the finite camera boundary: panning stops at
// its edges so the board cannot be dragged away and lost in empty space.
const SURFACE_SIZE = 4000;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

type Camera = { x: number; y: number; scale: number };
type PointerPosition = { x: number; y: number };
type CameraGesture =
  | {
      mode: 'pan';
      pointerId: number;
      startPointer: PointerPosition;
      startCamera: Camera;
    }
  | {
      mode: 'pinch';
      pointerIds: [number, number];
      startDistance: number;
      anchorOnBoard: PointerPosition;
      startCamera: Camera;
    };

function distance(a: PointerPosition, b: PointerPosition) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function midpoint(a: PointerPosition, b: PointerPosition): PointerPosition {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Keeps at least one edge of the finite board against every viewport edge.
 * If a zoomed-out board becomes smaller than an axis of the viewport, it is
 * centered on that axis instead of being allowed to drift into empty space.
 */
function clampCamera(camera: Camera, viewportWidth: number, viewportHeight: number): Camera {
  const scale = clamp(camera.scale, MIN_SCALE, MAX_SCALE);
  const surfaceWidth = SURFACE_SIZE * scale;
  const surfaceHeight = SURFACE_SIZE * scale;

  const minX = Math.min(0, viewportWidth - surfaceWidth);
  const maxX = Math.max(0, (viewportWidth - surfaceWidth) / 2);
  const minY = Math.min(0, viewportHeight - surfaceHeight);
  const maxY = Math.max(0, (viewportHeight - surfaceHeight) / 2);

  return {
    x: surfaceWidth <= viewportWidth ? maxX : clamp(camera.x, minX, 0),
    y: surfaceHeight <= viewportHeight ? maxY : clamp(camera.y, minY, 0),
    scale,
  };
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
  // Library grouping is derived from live media so freshly uploaded rows
  // appear immediately. Keep the server cluster prop in the public contract
  // for the existing page query and future persisted cluster metadata.
  void clusters;

  const [items, setItems] = useState<MediaRow[]>(media);
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const zCounterRef = useRef(items.reduce((max, item) => Math.max(max, item.z_index), 0));
  // Grouping belongs exclusively to Library mode. The corkboard always maps
  // the raw `items` array so every photo remains individually visible and a
  // user's persisted global position is never replaced by an album cover.
  const libraryAlbums = useMemo<LibraryAlbum[]>(
    () =>
      groupIntoAlbums(items).map((item) =>
        item.kind === 'album'
          ? item
          : { id: `album-loose-${item.media.id}`, items: [item.media] }
      ),
    [items]
  );
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const activeAlbum = useMemo(() => {
    if (!activeAlbumId) return null;
    return libraryAlbums.find((album) => album.id === activeAlbumId) ?? null;
  }, [activeAlbumId, libraryAlbums]);
  const isAlbumOpen = activeAlbum !== null;
  const isAlbumModalActive = isAlbumOpen;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 1 });
  const viewportSizeRef = useRef({ width: 0, height: 0, left: 0, top: 0 });
  const activePointersRef = useRef(new Map<number, PointerPosition>());
  const cameraGestureRef = useRef<CameraGesture | null>(null);
  const cameraX = useMotionValue(0);
  const cameraY = useMotionValue(0);
  const cameraScale = useMotionValue(1);
  const getBoardScale = useCallback(() => cameraScale.get(), [cameraScale]);
  const [isPanning, setIsPanning] = useState(false);
  const cameraBeforeAlbumRef = useRef<Camera | null>(null);
  const albumOpenRef = useRef(false);
  // Mirrors `isPanning` but for wheel/trackpad zoom, which has no discrete
  // start/end event of its own — just a burst of `wheel` events. Used only
  // to scope `will-change: transform` (see `isTransforming` below); reset
  // shortly after the last wheel event via a timeout rather than tracked
  // continuously, since that's all the CSS hint needs.
  const [isZooming, setIsZooming] = useState(false);
  const zoomIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyCamera = useCallback(
    (next: Camera) => {
      const viewport = viewportRef.current;
      let { width, height } = viewportSizeRef.current;
      if ((!width || !height) && viewport) {
        const rect = viewport.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
        viewportSizeRef.current = { width, height, left: rect.left, top: rect.top };
      }

      const bounded = clampCamera(next, width, height);
      cameraRef.current = bounded;
      // Motion values update the composited transform directly, without a
      // React render/reconciliation (or an album re-cluster) per pointermove.
      cameraX.set(bounded.x);
      cameraY.set(bounded.y);
      cameraScale.set(bounded.scale);
    },
    [cameraScale, cameraX, cameraY]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateViewportSize = () => {
      const rect = viewport.getBoundingClientRect();
      viewportSizeRef.current = {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
      };
      // Keep the camera frozen while the album is modal. We still record
      // the latest viewport bounds so the next board gesture uses accurate
      // coordinates after an orientation/window-size change.
      if (!albumOpenRef.current) applyCamera(cameraRef.current);
    };

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [applyCamera]);

  // Wheel/trackpad zoom. Must be a non-passive *native* listener: React
  // attaches `onWheel` as a passive listener by default, so
  // `e.preventDefault()` inside a synthetic onWheel handler is silently
  // ignored (and warns) — it would never stop the page itself from
  // scrolling while zooming the board.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // The focused album is modal: wheel input must neither mutate the
      // camera behind it nor bubble into page-level scrolling.
      if (isAlbumModalActive) {
        e.preventDefault();
        return;
      }

      // Library mode is an ordinary vertical document. Let its scroll area
      // consume wheel/trackpad input without touching the hidden camera.
      if (viewMode === 'library') return;

      const target = e.target;
      if (target instanceof Element && target.closest('.upload-fab, .upload-sheet-backdrop')) return;

      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const focus = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const current = cameraRef.current;
      const nextScale = clamp(current.scale * Math.exp(-e.deltaY * 0.001), MIN_SCALE, MAX_SCALE);
      const boardPoint = {
        x: (focus.x - current.x) / current.scale,
        y: (focus.y - current.y) / current.scale,
      };

      applyCamera({
        x: focus.x - boardPoint.x * nextScale,
        y: focus.y - boardPoint.y * nextScale,
        scale: nextScale,
      });
      setIsZooming(true);
      if (zoomIdleTimeoutRef.current) clearTimeout(zoomIdleTimeoutRef.current);
      zoomIdleTimeoutRef.current = setTimeout(() => setIsZooming(false), 200);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (zoomIdleTimeoutRef.current) clearTimeout(zoomIdleTimeoutRef.current);
    };
  }, [applyCamera, isAlbumModalActive, viewMode]);

  const startPan = useCallback((pointerId: number, point: PointerPosition) => {
    cameraGestureRef.current = {
      mode: 'pan',
      pointerId,
      startPointer: point,
      startCamera: { ...cameraRef.current },
    };
  }, []);

  const startPinch = useCallback((pointerIds: [number, number]) => {
    const first = activePointersRef.current.get(pointerIds[0]);
    const second = activePointersRef.current.get(pointerIds[1]);
    if (!first || !second) return;

    const center = midpoint(first, second);
    const current = cameraRef.current;
    cameraGestureRef.current = {
      mode: 'pinch',
      pointerIds,
      startDistance: Math.max(distance(first, second), 1),
      anchorOnBoard: {
        x: (center.x - current.x) / current.scale,
        y: (center.y - current.y) / current.scale,
      },
      startCamera: { ...current },
    };
  }, []);

  // Only the viewport and the otherwise-empty surface are camera targets.
  // Polaroids stop propagation themselves; buttons and modal UI are rejected
  // here as a second line of defense, so their gestures can never move both
  // the object and the camera.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isAlbumModalActive || viewMode !== 'board') return;
      if (e.target !== e.currentTarget && e.target !== surfaceRef.current) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      const rect = e.currentTarget.getBoundingClientRect();
      viewportSizeRef.current = {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
      };
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      activePointersRef.current.set(e.pointerId, point);
      const pointerIds = [...activePointersRef.current.keys()];

      if (pointerIds.length === 1) startPan(e.pointerId, point);
      if (pointerIds.length === 2) startPinch([pointerIds[0], pointerIds[1]]);
      setIsPanning(true);
    },
    [isAlbumModalActive, startPan, startPinch, viewMode]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isAlbumModalActive || viewMode !== 'board') return;
      if (!activePointersRef.current.has(e.pointerId)) return;
      e.preventDefault();
      const { left, top } = viewportSizeRef.current;
      activePointersRef.current.set(e.pointerId, { x: e.clientX - left, y: e.clientY - top });

      const gesture = cameraGestureRef.current;
      if (!gesture) return;

      if (gesture.mode === 'pan') {
        const point = activePointersRef.current.get(gesture.pointerId);
        if (!point) return;
        applyCamera({
          x: gesture.startCamera.x + point.x - gesture.startPointer.x,
          y: gesture.startCamera.y + point.y - gesture.startPointer.y,
          scale: gesture.startCamera.scale,
        });
        return;
      }

      const first = activePointersRef.current.get(gesture.pointerIds[0]);
      const second = activePointersRef.current.get(gesture.pointerIds[1]);
      if (!first || !second) return;

      const center = midpoint(first, second);
      const nextScale = clamp(
        gesture.startCamera.scale * (distance(first, second) / gesture.startDistance),
        MIN_SCALE,
        MAX_SCALE
      );
      applyCamera({
        x: center.x - gesture.anchorOnBoard.x * nextScale,
        y: center.y - gesture.anchorOnBoard.y * nextScale,
        scale: nextScale,
      });
    },
    [applyCamera, isAlbumModalActive, viewMode]
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!activePointersRef.current.has(e.pointerId)) return;
      activePointersRef.current.delete(e.pointerId);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }

      const remaining = [...activePointersRef.current.entries()];
      if (remaining.length === 0) {
        cameraGestureRef.current = null;
        setIsPanning(false);
        return;
      }

      // Seamlessly continue as a one-finger pan when one finger lifts from
      // a pinch, using the current camera as the new origin (no visible jump).
      if (remaining.length === 1) {
        startPan(remaining[0][0], remaining[0][1]);
      } else {
        startPinch([remaining[0][0], remaining[1][0]]);
      }
    },
    [startPan, startPinch]
  );

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

  const handleViewModeChange = useCallback((nextMode: ViewMode) => {
    if (nextMode === viewMode) return;

    // A mode switch must never leave a pointer captured by the camera. The
    // camera MotionValues themselves stay untouched, so returning to the
    // board resumes at the exact same pan/zoom coordinates.
    const viewport = viewportRef.current;
    for (const pointerId of activePointersRef.current.keys()) {
      if (viewport?.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    }
    activePointersRef.current.clear();
    cameraGestureRef.current = null;
    setIsPanning(false);
    setViewMode(nextMode);
  }, [viewMode]);

  const handleCreated = useCallback((row: MediaRow) => {
    setItems((prev) => [...prev, row]);
    zCounterRef.current = Math.max(zCounterRef.current, row.z_index);
  }, []);

  const handleAlbumPlacementChange = useCallback((mediaId: string, placement: AlbumPlacement) => {
    setItems((current) =>
      current.map((item) =>
        item.id === mediaId
          ? {
              ...item,
              album_page_index: placement.pageIndex,
              album_pos_x: placement.x,
              album_pos_y: placement.y,
              album_page_number: placement.pageIndex,
              album_page_x: placement.x,
              album_page_y: placement.y,
              album_placement_initialized: true,
            }
          : item
      )
    );
  }, []);

  // Reasonable initial drop spot for a newly uploaded item: roughly the
  // center of what's currently visible, translated from screen space into
  // the surface's own (pannable/zoomable) coordinate space, with a little
  // jitter so consecutive uploads don't stack exactly on top of each other.
  // This is an ephemeral interactive placement decision (not part of any
  // SSR-rendered output), so plain `Math.random()` here is fine — it's not
  // subject to the determinism requirement in design-system.md §5, which is
  // specifically about a card's *tilt*.
  const getDropPosition = useCallback((memoryTag: string | null) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const vw = rect?.width ?? 800;
    const vh = rect?.height ?? 600;
    const camera = cameraRef.current;
    const centerX = (vw / 2 - camera.x) / camera.scale;
    const centerY = (vh / 2 - camera.y) / camera.scale;
    const jitter = () => (Math.random() - 0.5) * 160;
    const visibleFallback = { x: centerX + jitter(), y: centerY + jitter() };
    return getTaggedDropPosition(items, memoryTag, visibleFallback, SURFACE_SIZE);
  }, [items]);

  const handleOpenAlbum = useCallback((albumId: string) => {
    // Defensive gesture cleanup means a cover tap can never leave a captured
    // pointer driving the hidden camera while the album transition begins.
    activePointersRef.current.clear();
    cameraGestureRef.current = null;
    setIsPanning(false);
    cameraBeforeAlbumRef.current = { ...cameraRef.current };
    albumOpenRef.current = true;
    setActiveAlbumId(albumId);
  }, []);

  const handleCloseAlbum = useCallback(() => {
    const savedCamera = cameraBeforeAlbumRef.current;
    setActiveAlbumId(null);
    albumOpenRef.current = false;
    cameraBeforeAlbumRef.current = null;

    // The surface remains mounted, and its MotionValues are normally already
    // unchanged. Re-applying this snapshot is a guard against any late input
    // event during the opening transition and guarantees an exact return to
    // the board location the user left.
    if (savedCamera) {
      cameraRef.current = savedCamera;
      cameraX.set(savedCamera.x);
      cameraY.set(savedCamera.y);
      cameraScale.set(savedCamera.scale);
    }
  }, [cameraScale, cameraX, cameraY]);

  return (
    <div
      ref={viewportRef}
      className="corkboard-viewport cork-texture"
      data-panning={isPanning}
      data-album-open={isAlbumModalActive}
      data-view-mode={viewMode}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
    >
      <ViewModeToggle value={viewMode} onChange={handleViewModeChange} disabled={isAlbumModalActive} />

      <AnimatePresence mode="wait" initial={false}>
        {viewMode === 'board' ? (
          <motion.div
            key="board"
            ref={surfaceRef}
            className="corkboard-surface"
            data-transforming={isPanning || isZooming}
            aria-hidden={isAlbumModalActive}
            inert={isAlbumModalActive ? true : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ x: cameraX, y: cameraY, scale: cameraScale, width: SURFACE_SIZE, height: SURFACE_SIZE }}
          >
            {items.map((mediaItem) => (
              <Polaroid
                key={mediaItem.id}
                media={mediaItem}
                boardScale={getBoardScale}
                onTransformChange={handleTransformChange}
                onBringToFront={handleBringToFront}
                onCaptionChange={handleCaptionChange}
              />
            ))}
          </motion.div>
        ) : (
          <LibraryView albums={libraryAlbums} onOpen={handleOpenAlbum} inactive={isAlbumModalActive} />
        )}
      </AnimatePresence>

      {viewMode === 'board' && items.length === 0 ? (
        <div className="corkboard-empty-state">
          <div className="corkboard-empty-state-card">
            <p className="corkboard-empty-state-title">The board is empty</p>
            <p className="corkboard-empty-state-subtitle">Tap the + button to pin your first photo or video.</p>
          </div>
        </div>
      ) : null}

      <UploadSheet onCreated={handleCreated} getDropPosition={getDropPosition} />

      {activeAlbum ? (
        <OpenAlbum
          album={activeAlbum}
          onClose={handleCloseAlbum}
          onPlacementChange={handleAlbumPlacementChange}
        />
      ) : null}
    </div>
  );
}
