export const POLAROID_CARD_WIDTH_PX = 210;
export const POLAROID_SIDE_PADDING_PX = 12;
export const POLAROID_TOP_PADDING_PX = 12;
export const POLAROID_CHIN_DEPTH_PX = 56;
export const POLAROID_MEDIA_WIDTH_PX =
  POLAROID_CARD_WIDTH_PX - POLAROID_SIDE_PADDING_PX * 2;

// Wide enough to preserve real phone panoramas and tall portraits at their
// intrinsic ratio, while still rejecting pathological metadata that could
// allocate a practically unbounded element.
export const POLAROID_MIN_MEDIA_ASPECT = 0.25;
export const POLAROID_MAX_MEDIA_ASPECT = 4;

export type PolaroidGeometry = Readonly<{
  cardWidth: number;
  cardHeight: number;
  mediaWidth: number;
  mediaHeight: number;
  mediaAspect: number;
}>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * One physical sizing contract for every Polaroid surface. The frame always
 * remains 210 CSS pixels wide at 1x; only its media well and total height
 * follow the source dimensions. Invalid metadata falls back to a square.
 */
export function getPolaroidGeometry(
  sourceWidth: number | null | undefined,
  sourceHeight: number | null | undefined
): PolaroidGeometry {
  const rawAspect =
    typeof sourceWidth === 'number' &&
    typeof sourceHeight === 'number' &&
    Number.isFinite(sourceWidth) &&
    Number.isFinite(sourceHeight) &&
    sourceWidth > 0 &&
    sourceHeight > 0
      ? sourceWidth / sourceHeight
      : 1;
  const mediaAspect = clamp(
    rawAspect,
    POLAROID_MIN_MEDIA_ASPECT,
    POLAROID_MAX_MEDIA_ASPECT
  );
  const mediaHeight = POLAROID_MEDIA_WIDTH_PX / mediaAspect;

  return {
    cardWidth: POLAROID_CARD_WIDTH_PX,
    cardHeight: POLAROID_TOP_PADDING_PX + mediaHeight + POLAROID_CHIN_DEPTH_PX,
    mediaWidth: POLAROID_MEDIA_WIDTH_PX,
    mediaHeight,
    mediaAspect,
  };
}
