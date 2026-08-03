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
  --font-caption: var(--font-solitreo), cursive;
  --font-ui: var(--font-sans-ui), system-ui, sans-serif;

  /* Motion */
  --ease-wiggle: cubic-bezier(0.36, 0.07, 0.19, 0.97);
  --duration-wiggle: 0.4s;
  --duration-lift: 0.18s;
}
```

`Solitreo` is loaded via `next/font/google` with `subsets: ["hebrew", "latin", "latin-ext"]`
(the family is Hebrew-speaking — PRD §4 itself labels pushpins "הנעצים") and exposed as
`--font-solitreo`. It replaced an earlier `Caveat` + `Kalam` fallback chain: neither of those
has a Hebrew subset in next/font's Google Fonts data, so Hebrew captions were silently
rendering in the browser's generic fallback, not a handwriting face. Solitreo is a genuine
cursive Hebrew script whose Latin glyphs also render in a flowing script style, so a single
font now covers both scripts — see §6 for the comparison that led here. UI chrome (buttons,
nav, forms) uses a separate clean sans (`--font-sans-ui`) — only captions should look
handwritten.

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

Implemented as a standalone `.cork-texture` class in
`src/components/corkboard/cork-texture.css` (imported by `background.css`), so any other
full-bleed surface that wants the identical texture — e.g. the `/login` page's
corkboard-with-a-pinned-Polaroid shell (§9) — composes this one class instead of re-deriving
the layers by hand.

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

- **Captions** (handwritten notes on the Polaroid chin): `Solitreo`, weight 400 (its only
  weight), loaded via `next/font/google`, `subsets: ["hebrew", "latin", "latin-ext"]`,
  `display: "swap"`.
- **Why Solitreo**: `next/font/google`'s bundled catalog (the actual source of truth for what
  builds — not the live Google Fonts website) lists ~61 families with a `hebrew` subset; of
  those, three read as genuine handwriting/script candidates:
  - `Playpen Sans Hebrew` (variable 100–800) — a casual, rounded, kid's-print handwriting
    family. Rendered as a bold, rounded marker/print style in both scripts — legible and
    consistent across scripts, but does not read as *cursive*.
  - `Solitreo` (weight 400 only) — a real historical cursive Hebrew script (traditionally used
    for Ladino/Judeo-Spanish). Its Latin glyphs *also* render in a flowing cursive style, not a
    merely-functional companion face as initially suspected.
  - `Rubik Scribble` (weight 400 only) — a doodly/scribbled display style. Rendered too
    faint/low-contrast (thin outline strokes) to read comfortably at the `.polaroid-chin` size
    (`1.35rem`).

  All three were rendered side-by-side with sample Latin and Hebrew text at the actual caption
  size, including an in-context mockup of the real `.polaroid-chin` box (padding, height,
  ellipsis truncation). Solitreo was the only candidate that reads as genuinely
  handwritten/cursive in *both* scripts and matches the flowing spirit of the previous Caveat
  choice for Latin — so it replaced Caveat/Kalam entirely rather than pairing two fonts behind
  a `lang`/script check.
- **No separate fallback font is needed**: Solitreo alone covers both scripts. The CSS fallback
  chain (`var(--font-solitreo), cursive`) only exists for the (unlikely) case the webfont fails
  to load at all.
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

---

## 9. The `/login` page

`/login` is styled as a large Polaroid pinned to the corkboard, not a generic centered form —
it should read as part of the same physical object as the board itself:

- **Background**: the same `.cork-texture` class (§2) the board uses, applied directly to the
  page's outer `<main>`. No pan/zoom/drag on this page, so none of `.corkboard-viewport`'s
  interaction rules (cursor, touch-action) apply — only the texture is shared.
- **Card**: the actual `.polaroid-body`/`.polaroid-chin` classes from `polaroid.css` (§3),
  unmodified — same off-white background, the same `12px 12px 56px 12px` asymmetric padding,
  the same paper-grain overlay, and the exact `--shadow-polaroid` box-shadow token. A dedicated
  `.login-polaroid` wrapper (`src/app/login/login.css`) only adds page-specific sizing
  (`width: min(92vw, 380px)`) and a fixed `rotate(-2deg)` tilt — within §5's `[-3.5, 3.5]`
  range, but a constant rather than hashed from a media UUID, since there's no media row on
  this page to hash from (§5's determinism requirement is about board-card SSR/hydration
  agreement specifically; a login page rendered once doesn't have that hazard — it just must
  not be `Math.random()`, which would reshuffle across re-renders too).
- **Pushpin**: the real `<Pushpin>` component (§4), not a redrawn approximation, placed as a
  sibling of `.polaroid-body` inside the `position: relative` `.login-polaroid` wrapper — the
  same structural relationship `<Polaroid>` itself uses.
- **Content mapping**: the email form (heading, input, submit button, error/sent states) occupies
  the "photo" region in `--font-ui` — form controls stay legible sans, per §6's rule that only
  captions look handwritten — while the chin carries a short handwritten caption ("Keeps") in
  `--font-caption`, exactly like a photo's caption everywhere else on the board.
- **State preservation**: the shell is constant across `idle`/`loading`/`sent`/`error` — only
  the photo-region content swaps (form vs. the "check your email" confirmation), so the page
  never jumps between two unrelated layouts the way the original plain-form version did.
