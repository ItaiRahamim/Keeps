# Keeps — Design System: "Pinned Keeps" Aesthetic

Source: PRD §4 (UI/UX Design System), expanded into implementable tokens and component specs.
Read this before building any Corkboard/Polaroid/Pushpin UI. Do not invent alternate values —
every number below is deliberate (rotation range, shadow spec, chin height) and several are
copied verbatim from the PRD.

Reference material available in `.claude/skills/ui-ux-pro-max/`, `.claude/skills/design-system/`,
and `.claude/skills/ui-styling/` (installed skills) for broader pattern/motion/typography lookup
if a case isn't covered here.

---

## 1. Tailwind v4 wiring (CSS-first — no `tailwind.config.js`)

All tokens below live in `src/app/globals.css` inside an `@theme { }` block:

```css
@import "tailwindcss";

@theme {
  /* Surfaces */
  --color-cork: #CDBA96;
  --color-cork-dark: #B89F76;   /* grain shadow tone, not a separate bg */
  --color-polaroid: #FDFBF7;
  --color-polaroid-shadow-tint: #3a2f22;

  /* Pushpin palette — fixed set of 5, chosen deterministically per card (see §4) */
  --color-pin-red: #C6432B;
  --color-pin-mustard: #D9A521;
  --color-pin-teal: #2E7D6B;
  --color-pin-cream: #E8DCC4;
  --color-pin-slate: #4A5568;

  /* Shadows */
  --shadow-polaroid: 2px 8px 15px rgba(0,0,0,0.4);       /* PRD-specified, verbatim */
  --shadow-polaroid-lifted: 4px 16px 28px rgba(0,0,0,0.45); /* hover/drag state */
  --shadow-pin: 1px 2px 3px rgba(0,0,0,0.5);

  /* Typography */
  --font-caption: var(--font-caveat), "Kalam", cursive;
  --font-ui: var(--font-sans-ui), system-ui, sans-serif;

  /* Motion */
  --ease-wiggle: cubic-bezier(0.36, 0.07, 0.19, 0.97);
  --duration-wiggle: 0.4s;
  --duration-lift: 0.18s;
}
```

`Caveat` is loaded via `next/font/google` with `subsets: ["latin", "hebrew"]` (the family is
Hebrew-speaking — PRD §4 itself labels pushpins "הנעצים") and exposed as `--font-caveat`.
Kalam is documented as the fallback with broader Hebrew glyph coverage; use it if Caveat's
Hebrew subset ever looks thin in practice. UI chrome (buttons, nav, forms) uses a separate
clean sans (`--font-sans-ui`) — only captions should look handwritten.

---

## 2. Corkboard background

Base color `#CDBA96` per PRD. Built as a **pure CSS layer stack**, no image asset — keeps the
PWA payload small and tiles perfectly at any pan/zoom offset (an image texture would show seams
on a draggable, potentially-infinite board).

Three stacked layers on the board container, back to front:

1. **Base fill** — `background-color: var(--color-cork)`.
2. **Cork fleck grain** — a repeating radial-gradient at small scale to fake the fibrous cork
   texture:
   ```css
   background-image:
     radial-gradient(circle at 20% 30%, rgba(0,0,0,0.06) 0, transparent 1.5px),
     radial-gradient(circle at 60% 70%, rgba(0,0,0,0.05) 0, transparent 1.2px),
     radial-gradient(circle at 40% 85%, rgba(255,255,255,0.04) 0, transparent 1px);
   background-size: 18px 18px, 24px 24px, 14px 14px;
   ```
3. **Fractal-noise overlay** — a low-opacity (`~0.05`) inline SVG `feTurbulence` data-URI over
   the whole surface for paper/cork "tooth," `mix-blend-mode: overlay`.

Plus an `inset box-shadow` vignette on the outer board wrapper
(`box-shadow: inset 0 0 120px rgba(0,0,0,0.25)`) so the board reads as a physical panel with
depth falloff at the edges, not a flat infinite fill.

All three layers use `background-repeat` and fixed `background-size` (not viewport-relative),
so panning the board never reveals a texture seam.

---

## 3. The Polaroid card

- Background `#FDFBF7` (off-white, per PRD).
- **Asymmetric padding** — this is what makes it read as a Polaroid, not a generic card:
  `padding: 12px 12px 56px 12px` (top/left/right tight, bottom "chin" wide enough for a
  handwritten caption line).
- Subtle paper grain overlay at `~4% opacity` (same `feTurbulence` technique as the corkboard,
  lower intensity, no color tint).
- Shadow **exactly** per PRD: `box-shadow: var(--shadow-polaroid)` i.e.
  `2px 8px 15px rgba(0,0,0,0.4)`. On hover/drag, transition to `--shadow-polaroid-lifted`
  over `--duration-lift` to sell the card lifting off the board toward the viewer.
- The media (photo or video-thumbnail) fills the top square/rect region above the chin, `object-fit: cover`.
- Caption text sits in the chin, `font-family: var(--font-caption)`, dark warm gray
  (`#3a2f22`-ish, not pure black — pure black on off-white under handwriting font reads
  harsh), centered or left-aligned per content length.

---

## 4. Pushpin

Inline SVG component (`<Pushpin />`), not a raster image — needs to scale crisply and recolor
per-instance via CSS custom property, which a PNG can't do cheaply.

**Construction**, two parts:
- **Head**: circle with a `radial-gradient` fill — specular highlight top-left (lightened ~30%
  of the pin color), dark rim bottom-right (darkened ~25%) — so it reads as a glossy plastic
  sphere, not a flat dot.
- **Shaft**: a short thin trapezoid/line beneath the head, angled slightly down-right, with its
  own small drop-shadow (`--shadow-pin`) cast onto the Polaroid paper below it — this is what
  sells the pin sitting *above* the card rather than printed on it.

**Position**: top-center by default, `transform: translate(-50%, -40%)` relative to the
Polaroid's top edge so it overlaps the boundary. Corner variants (top-left, top-right) are
supported via a `position` prop for visual variety across a board full of cards.

**Color**: chosen from the fixed 5-color palette (`--color-pin-{red,mustard,teal,cream,slate}`)
**deterministically** from a hash of the media row's UUID — `hash(id) % 5`. Never randomized at
render time, or a card's pin color would flicker between the 5 options on every re-render/SSR
hydration.

**Motion** (Framer Motion): on hover, the pin plays a quick wiggle —
```js
animate: { rotate: [0, -8, 6, -4, 0] }
transition: { duration: 0.4, ease: [0.36, 0.07, 0.19, 0.97] }
```
and the *parent Polaroid* rotates a fraction of that same motion with
`transform-origin` set to the pin's position — visually the card hangs from and swings
around the pin, not the reverse.

---

## 5. Controlled randomness (rotation)

Per PRD: `transform: rotate(Ndeg)` where `N ∈ [-3.5, 3.5]`.

**Must be deterministic**, derived from a hash of the media row's UUID (the same hash that
picks pin color, different modulus/mapping):

```ts
function rotationForId(id: string): number {
  const h = hashString(id); // simple string hash, e.g. FNV-1a or similar
  return (h % 700) / 100 - 3.5; // → [-3.5, 3.5]
}
```

Not `Math.random()` — the App Router renders on the server first, and a random value would
differ between server and client render, producing a hydration mismatch. It would also
reshuffle the entire board's tilt on every re-render (e.g. after any state update), which reads
as broken, not "tactile."

---

## 6. Typography

- **Captions** (handwritten notes on the Polaroid chin): `Caveat`, variable weight 400–700,
  loaded via `next/font/google`, `subsets: ["latin", "hebrew"]`, `display: "swap"`.
- **Fallback**: `Kalam` — slightly better Hebrew glyph shapes if Caveat's Hebrew coverage proves
  thin in testing.
- **UI chrome** (nav, buttons, forms, upload sheet): a separate clean sans, *not* the caption
  font — only handwritten content should look handwritten; UI controls in a script font hurt
  legibility and feel like a novelty theme rather than a designed product.

---

## 7. Motion & accessibility

- Wiggle/tilt durations: `--duration-wiggle: 0.4s`, easing `--ease-wiggle`.
- Card lift transition: `--duration-lift: 0.18s`, standard ease-out.
- Drag: spring physics (Framer Motion `type: "spring"`, moderate stiffness/damping — should
  feel weighted, not floaty).
- **`prefers-reduced-motion: reduce`**: disable the pin wiggle and the hover/drag rotational
  lift entirely (keep the shadow-lift transition, which is not vestibular-triggering). Static
  rotation from §5 is layout, not motion — it stays in both modes.

---

## 8. Video-in-Polaroid

The video Polaroid uses the *exact same* `<Polaroid>` frame/shadow/pin/rotation as a photo —
this is the point of the feature per PRD §3.2 ("Videos appear exactly like photos"). On tap:

- The WebP thumbnail crossfades (opacity, ~200ms) into a borderless `<video>` element that
  fills the identical media region.
- The `<video>` element must never cause the Polaroid frame to resize, reflow, or remount —
  same aspect-ratio box, same padding, same shadow. Only the innermost media layer changes.
- Autoplay, loop, muted, `playsInline` (required for iOS inline playback — without it iOS forces
  fullscreen takeover, breaking the "plays inside the frame" requirement).
