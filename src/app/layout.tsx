import type { Metadata, Viewport } from "next";
import { Caveat, Geist, Geist_Mono } from "next/font/google";
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
// DEVIATION FROM SPEC: the task asked for `subsets: ["latin", "hebrew"]`
// because the family is Hebrew-speaking, but Caveat has no "hebrew" subset
// in Google Fonts / next/font's metadata (verified in
// node_modules/next/dist/compiled/@next/font/dist/google/font-data.json —
// Caveat only ships cyrillic, cyrillic-ext, latin, latin-ext). Requesting an
// unsupported subset throws at build time, so it's omitted here. Hebrew
// caption text will fall through to the `"Kalam", cursive` fallback chain in
// `--font-caption` — but note Kalam *also* has no hebrew subset in next/font's
// data, so in practice Hebrew captions currently render in the browser's
// generic cursive/sans fallback, not a handwriting face. Flagging for the
// UI/UX agent: a Hebrew-capable handwriting web font may need to be sourced
// separately if this matters for launch.
const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
