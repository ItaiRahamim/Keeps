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
  applicationName: "memokeeps",
  description: "memokeeps is a family photo & video corkboard.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "memokeeps",
    statusBarStyle: "black-translucent",
  },
  // Next.js 16 emits the standards-based `mobile-web-app-capable` tag for
  // `appleWebApp.capable`; keep Apple's legacy tag too for older iOS builds.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#b8865b",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${playpenSansHebrew.variable} h-dvh min-h-dvh antialiased`}
    >
      {/*
        `h-dvh` is load-bearing here: it gives every percentage-height board
        descendant a definite containing block while tracking iOS's dynamic
        standalone viewport all the way through the home-indicator region.
        `<main className="relative flex-1">` in page.tsx renders
        `<Corkboard>`, whose root `.corkboard-viewport` uses `height: 100%`
        to fill it (background.css) — and every one of its own children
        (`.corkboard-surface`, `.corkboard-empty-state`, the upload FAB) is
        `position: absolute`/`fixed`, so `.corkboard-viewport` has zero
        in-flow content to fall back on for an auto height.
        A minimum height is insufficient for resolving that percentage. The
        explicit dynamic height also removes the need for document padding:
        the cork texture paints to the physical bottom, while fixed controls
        independently apply `env(safe-area-inset-bottom)` to their offsets.
      */}
      <body className="h-dvh min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
