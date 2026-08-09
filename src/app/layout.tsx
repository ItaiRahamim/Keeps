import type { Metadata, Viewport } from "next";
import { Caveat, Geist, Geist_Mono, Playpen_Sans_Hebrew } from "next/font/google";
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

// Caveat remains the original English handwriting face. It intentionally
// loads only Latin glyphs, so Hebrew text naturally advances to the next
// family in `--font-caption` instead of requiring lang/dir selectors.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  display: "swap",
  // next/font otherwise injects "Caveat Fallback" into this variable.
  // That metric fallback contains Hebrew glyphs and captures them before
  // the following Playpen family can be considered by the browser.
  adjustFontFallback: false,
});

// Playpen Sans Hebrew supplies the missing handwritten Hebrew glyphs. The
// generated variable is placed after Caveat in the caption family stack,
// preserving Caveat for English and using this face only as glyph fallback.
const playpenSansHebrew = Playpen_Sans_Hebrew({
  variable: "--font-playpen-sans-hebrew",
  subsets: ["hebrew"],
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "memokeeps",
  description: "memokeeps is a family photo & video corkboard.",
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
      className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${playpenSansHebrew.variable} h-full antialiased`}
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
