import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Solitreo } from "next/font/google";
import "./globals.css";

// UI chrome font (buttons, nav, forms) — NOT the handwritten caption font.
// Re-exposed as --font-sans-ui so design-system.md's `--font-ui` token
// (`var(--font-sans-ui), system-ui, sans-serif`) resolves correctly.
const geistSans = Geist({
  variable: "--font-sans-ui",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Handwritten caption font for Polaroid captions (design-system.md §1/§6).
//
// RESOLVED Hebrew-support gap: an earlier pass here used `Caveat`, which
// has zero Hebrew glyph coverage in next/font's Google Fonts data (verified
// against node_modules/next/dist/compiled/@next/font/dist/google/font-data.json
// — Caveat ships only cyrillic/cyrillic-ext/latin/latin-ext), and the
// documented fallback (`Kalam`) turned out to have *no* Hebrew subset
// either, so Hebrew captions were silently rendering in the browser's
// generic serif/cursive fallback, not a handwriting face — a real gap for
// a Hebrew-speaking family.
//
// Replaced with `Solitreo`: a genuine historical *cursive Hebrew* script
// (`subsets: ["hebrew", "latin", "latin-ext"]`, weight 400 only) that also
// renders its Latin glyphs in a flowing script style — visually verified
// side-by-side against Caveat, Playpen Sans Hebrew, and Rubik Scribble at
// the actual `.polaroid-chin` size (1.35rem): Solitreo was the only
// Hebrew-capable candidate that reads as genuinely handwritten/cursive in
// *both* scripts (Playpen Sans Hebrew is a bold rounded print/marker style
// in both scripts — legible but not cursive; Rubik Scribble renders as a
// faint sketchy outline, too low-contrast to read comfortably at this
// size). One font now covers both scripts, so no lang-conditional CSS is
// needed.
const solitreo = Solitreo({
  variable: "--font-solitreo",
  subsets: ["hebrew", "latin", "latin-ext"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Keeps",
  description: "A family photo & video corkboard.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#CDBA96",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${solitreo.variable} h-full antialiased`}
    >
      {/*
        `h-full` (an explicit `height: 100%`), not `min-h-full`
        (`min-height: 100%`), is load-bearing here.
        `<main className="relative flex-1">` in page.tsx renders
        `<Corkboard>`, whose root `.corkboard-viewport` uses `height: 100%`
        to fill it (background.css) — and every one of its own children
        (`.corkboard-surface`, `.corkboard-empty-state`, the upload FAB) is
        `position: absolute`/`fixed`, so `.corkboard-viewport` has zero
        in-flow content to fall back on for an auto height.
        Per CSS2.1 §10.5, a percentage `height` only resolves against a
        containing block whose height was "specified explicitly" — and
        `min-height` does NOT count, even once the box's flex-grown/clamped
        *rendered* size fills the viewport. `min-h-full` here left every
        ancestor's height "indefinite" for that purpose, so `.corkboard-viewport`'s
        `height: 100%` fell back to `auto` -> resolved to 0 against its
        all-out-of-flow children -> the entire cork-textured board (and any
        Polaroids on it) collapsed invisibly, leaving only the flat body
        background and the fixed-position upload FAB visible. Confirmed via
        a live, HMR-independent DOM+CSS repro (isolated test nodes, no
        React/Corkboard involved): swapping just this class from
        `min-h-full` to `h-full` took a percentage-sized child from
        `height: 0px` to its correct flex-grown share. `h-full` gives
        `body` (and everything under it) a height CSS treats as definite,
        so `height: 100%` resolves all the way down.
      */}
      <body className="h-full flex flex-col">{children}</body>
    </html>
  );
}
