export type DragPoint = Readonly<{ x: number; y: number }>;

/**
 * Converts a pointer delta measured in viewport pixels into the unscaled
 * coordinate space of the corkboard. Keeping this math pure makes it clear
 * that the persisted position is always derived from the position captured
 * at pointer-down, never from a stale render or a previous drag offset.
 */
export function positionFromPointerDelta(
  origin: DragPoint,
  pointerStart: DragPoint,
  pointerCurrent: DragPoint,
  boardScale: number
): DragPoint {
  const safeScale = Number.isFinite(boardScale) && boardScale > 0 ? boardScale : 1;

  return {
    x: origin.x + (pointerCurrent.x - pointerStart.x) / safeScale,
    y: origin.y + (pointerCurrent.y - pointerStart.y) / safeScale,
  };
}
