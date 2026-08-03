import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// R2-hosted media (photo/video originals + thumbnails) lives on a different
// origin than the app and can be large (video especially). It must NEVER be
// precached — precaching runs on every SW activation, and precaching
// multi-MB video would blow the cache storage quota and slow down every
// deploy. Instead it gets its own *runtime-only* route: NetworkFirst so the
// freshest asset wins while online, falling back to the cache when
// offline/flaky. This rule is intentionally not part of `precacheEntries` —
// only build-output assets belong there.
const r2MediaCaching: RuntimeCaching = {
  matcher: ({ url, sameOrigin }) => {
    if (sameOrigin) return false;
    return /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|heic|heif)$/i.test(
      url.pathname
    );
  },
  handler: new NetworkFirst({
    cacheName: "r2-media",
    networkTimeoutSeconds: 4,
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // Order matters: first match wins, so the R2 media rule must come before
  // Next.js's defaultCache rules.
  runtimeCaching: [r2MediaCaching, ...defaultCache],
});

serwist.addEventListeners();
