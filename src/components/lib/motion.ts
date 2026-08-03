// Shared Framer Motion constants for the pushpin wiggle and the fractional
// card-sway that syncs with it (design-system.md §4/§7). Kept in one place
// so Pushpin.tsx and Polaroid.tsx always animate in lockstep, and so
// `prefers-reduced-motion` handling only needs to disable one thing.

/** design-system.md §4, verbatim keyframes (degrees) for the pin wiggle. */
export const PIN_WIGGLE_KEYFRAMES = [0, -8, 6, -4, 0];

/** design-system.md §1/§4: --duration-wiggle / --ease-wiggle, verbatim. */
export const WIGGLE_TRANSITION = {
  duration: 0.4,
  ease: [0.36, 0.07, 0.19, 0.97] as [number, number, number, number],
};

/**
 * design-system.md §4: "the parent Polaroid rotates a fraction of that same
 * motion" — this is that fraction. A judgment call (the doc doesn't pin an
 * exact number): small enough that the card reads as swaying from the pin,
 * not wiggling as hard as the pin itself.
 */
export const CARD_WIGGLE_FRACTION = 0.15;

/**
 * Extra static tilt applied while a card is actively being dragged (picked
 * up off the board). Disabled under `prefers-reduced-motion` along with the
 * hover wiggle, per design-system.md §7 ("hover/drag rotational lift").
 */
export const DRAG_TILT_DEG = 2.5;

/** design-system.md §1/§7: --duration-lift, for the shadow-lift transition. */
export const LIFT_TRANSITION_MS = 180;
