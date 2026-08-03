// Deterministic per-card visual properties: rotation and pushpin color/position.
//
// design-system.md §5 requires these to be derived from a pure hash of the
// media row's UUID — never `Math.random()`/`Date.now()` — so the server-
// rendered HTML and the client hydration pass agree exactly, and so a card's
// tilt/pin color never reshuffles on re-render. Shared by Polaroid.tsx
// (render-time rotation + pin color/position) and UploadSheet.tsx (which
// must compute the *same* rotation for a freshly created row once its
// server-assigned id comes back from `createMedia` — see that file for why).

/** FNV-1a 32-bit string hash. Pure function, no external entropy. */
export function hashString(id: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // unsigned 32-bit
}

/**
 * design-system.md §5: `transform: rotate(Ndeg)`, N in [-3.5, 3.5],
 * deterministic per id.
 */
export function rotationForId(id: string): number {
  const h = hashString(id);
  return (h % 700) / 100 - 3.5;
}

/** Fixed 5-color pushpin palette — tokens defined in globals.css `@theme`. */
export const PIN_COLORS = ['red', 'mustard', 'teal', 'cream', 'slate'] as const;
export type PinColor = (typeof PIN_COLORS)[number];

/** design-system.md §4: `hash(id) % 5` into the fixed pin-color palette. */
export function pinColorForId(id: string): PinColor {
  const h = hashString(id);
  return PIN_COLORS[h % PIN_COLORS.length];
}

/**
 * design-system.md §4: "Corner variants (top-left, top-right) are supported
 * via a position prop for visual variety across a board full of cards."
 * Derived deterministically (a different modulus of the same hash) rather
 * than randomly, for the same hydration-safety reason as rotation/color.
 */
export const PIN_POSITIONS = ['top', 'top-left', 'top-right'] as const;
export type PinPosition = (typeof PIN_POSITIONS)[number];

export function pinPositionForId(id: string): PinPosition {
  const h = hashString(id);
  return PIN_POSITIONS[Math.floor(h / 11) % PIN_POSITIONS.length];
}

/**
 * Single source of truth for "where the pin sits" (horizontal %), shared by
 * Pushpin.tsx (pin's own left offset) and Polaroid.tsx (rotation
 * transform-origin, so the card visually pivots around the pin it hangs
 * from rather than its own center).
 */
export const PIN_POSITION_LEFT_PERCENT: Record<PinPosition, string> = {
  top: '50%',
  'top-left': '18%',
  'top-right': '82%',
};

export const PIN_POSITION_TRANSFORM_ORIGIN: Record<PinPosition, string> = {
  top: '50% 0%',
  'top-left': '18% 0%',
  'top-right': '82% 0%',
};
