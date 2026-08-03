'use client';

import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PIN_POSITION_LEFT_PERCENT, type PinColor, type PinPosition } from '../lib/deterministic';
import { PIN_WIGGLE_KEYFRAMES, WIGGLE_TRANSITION } from '../lib/motion';

export type PushpinProps = {
  /** One of the 5 fixed palette tokens, chosen deterministically per card
   *  (see `pinColorForId` in `../lib/deterministic`). */
  color: PinColor;
  /** Corner variant, per design-system.md §4. Defaults to top-center. */
  position?: PinPosition;
  /**
   * Whether the pin should play its hover wiggle right now. Controlled by
   * the parent Polaroid rather than the pin's own `whileHover`: the pin is a
   * small hit target and design-system.md §4 wants the *card* to sway in
   * sync around the pin, so hover is tracked once (on the card) and handed
   * down to both the pin and the card's own rotation.
   */
  hovered?: boolean;
};

/**
 * Inline SVG pushpin — design-system.md §4. Two parts: a glossy gradient
 * head (specular highlight top-left, dark rim bottom-right) and a small
 * shadowed shaft beneath it, angled down-right, so it reads as sitting
 * *above* the polaroid paper rather than printed on it.
 */
export default function Pushpin({ color, position = 'top', hovered = false }: PushpinProps) {
  const uid = useId();
  const shouldReduceMotion = useReducedMotion();
  const playWiggle = hovered && !shouldReduceMotion;
  const left = PIN_POSITION_LEFT_PERCENT[position];
  const headGradId = `pin-head-${uid}`;
  const shadowFilterId = `pin-shadow-${uid}`;

  return (
    <motion.svg
      viewBox="0 0 32 40"
      width={30}
      height={38}
      aria-hidden="true"
      focusable="false"
      style={{
        position: 'absolute',
        left,
        top: 0,
        zIndex: 2,
        transform: 'translate(-50%, -40%)',
        transformOrigin: '50% 35%',
        // Decorative only — hovering/tapping the (small) pin shouldn't
        // "steal" the hit test from the card underneath it; the card as a
        // whole is the hover/drag surface, and the pin's own DOM containment
        // inside it is enough for its wiggle to stay in sync.
        pointerEvents: 'none',
      }}
      animate={{ rotate: playWiggle ? PIN_WIGGLE_KEYFRAMES : 0 }}
      transition={WIGGLE_TRANSITION}
    >
      <defs>
        <radialGradient id={headGradId} cx="35%" cy="30%" r="75%">
          {/* Specular highlight: ~30% lightened toward white. */}
          <stop offset="0%" style={{ stopColor: `color-mix(in srgb, var(--color-pin-${color}) 70%, white 30%)` }} />
          <stop offset="55%" style={{ stopColor: `var(--color-pin-${color})` }} />
          {/* Dark rim: ~25% darkened toward black. */}
          <stop
            offset="100%"
            style={{ stopColor: `color-mix(in srgb, var(--color-pin-${color}) 75%, black 25%)` }}
          />
        </radialGradient>
        <filter id={shadowFilterId} x="-60%" y="-60%" width="220%" height="220%">
          {/*
            Numeric translation of --shadow-pin (1px 2px 3px rgba(0,0,0,0.5))
            into SVG filter primitives — feDropShadow can't consume a CSS
            box-shadow custom property directly, so these are hand-matched.
          */}
          <feDropShadow dx="1" dy="2" stdDeviation="1.3" floodColor="#000000" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* Shaft: short trapezoid angled down-right beneath the head, casting
          its own drop-shadow onto the polaroid paper below. Darkened further
          than the head's rim since it sits in the head's own shadow. */}
      <path
        d="M13.5 19 L18.5 19 L21 31 L11 31 Z"
        style={{ fill: `color-mix(in srgb, var(--color-pin-${color}) 55%, black 45%)` }}
        filter={`url(#${shadowFilterId})`}
      />

      {/* Head: glossy plastic sphere. */}
      <circle cx="16" cy="14" r="12" fill={`url(#${headGradId})`} filter={`url(#${shadowFilterId})`} />
    </motion.svg>
  );
}
