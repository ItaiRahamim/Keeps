import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const baseConfig: NextConfig = {
  images: {
    // Next.js 16 removed `images.domains` — `remotePatterns` is required for
    // any next/image src on a remote host (see version-16 upgrade docs).
    // Confirmed R2 bucket public dev domain (keeps-media).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-df9af4c1dda94069af1d362573021f55.r2.dev",
      },
    ],
  },
};

// DEVIATION: @serwist/next (pinned 9.5.12) has no Turbopack support yet
// (https://github.com/serwist/serwist/issues/54) — it works by injecting a
// `webpack()` function into the Next config, unconditionally, even when
// `disable: true` is passed to it. Next.js 16 hard-errors (crashing the
// whole dev server / build) the moment it finds a `webpack` config while
// compiling with Turbopack, its new default builder. There is no way to
// keep the standard `withSerwistInit` (injection-mode) API AND run
// `next dev` / `next build` on Turbopack with this package version.
//
// Resolution used here: only construct/apply the serwist wrapper for
// production builds (`next build`), which this repo's `package.json`
// "build" script runs as `next build --webpack` for exactly this reason.
// `next dev` is left on plain Turbopack with no service worker — there is
// nothing worth precaching in dev, and the PWA/offline behavior only
// matters in production anyway. `withSerwistInit` is only *called* inside
// this branch (not just its result discarded) so it doesn't also fire its
// own "you're on Turbopack" warning during `next dev`.
const nextConfig: NextConfig =
  process.env.NODE_ENV === "production"
    ? withSerwistInit({
        swSrc: "src/app/sw.ts",
        swDest: "public/sw.js",
      })(baseConfig)
    : baseConfig;

export default nextConfig;
