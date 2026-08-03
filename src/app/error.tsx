'use client';

// Route-segment error boundary (Next.js App Router convention). Catches any
// uncaught render/render-time exception thrown by `page.tsx` or anything
// underneath it (Corkboard, Polaroid, etc.) that isn't already handled
// locally. Before this file existed, there was NO error boundary anywhere in
// the app below the root layout, so any uncaught exception in the client
// tree unmounted everything with zero visible signal in production — which
// is indistinguishable from "the board is just blank."
//
// NOTE on `error.message` in production: for errors that originate in a
// Server Component (e.g. `getMedia()`/`getClusters()` throwing in
// `page.tsx`), Next.js deliberately REDACTS the real message before it
// crosses the server->client boundary in production builds, replacing it
// with a generic message + a `digest` correlation id (see
// node_modules/next/dist/docs/.../error.md). That's why `page.tsx` ALSO
// wraps its data fetching in its own try/catch and renders the real error
// text directly as plain output (see src/app/page.tsx) — that path never
// goes through this redaction. This boundary still matters for anything
// that throws on the client (e.g. inside Corkboard/Polaroid rendering),
// where `error.message` is never redacted.
import '@/components/corkboard/cork-texture.css';
import './error-fallback.css';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    // Renders inside the root layout (this segment's own error boundary
    // does NOT bypass it — only global-error.tsx does that), so the real
    // theme tokens/fonts from globals.css and next/font are available here,
    // same as anywhere else on the board. `.cork-texture` gives this
    // failure state the same physical background as a successful render
    // instead of relying on `body`'s fallback color showing through.
    <main className="relative flex-1 cork-texture error-fallback-main">
      <div className="error-fallback-card">
        <h1 className="error-fallback-title">Something broke while rendering the board</h1>
        <p className="error-fallback-lede">
          This is the actual error (in production, Server Component errors are redacted to
          a generic message + digest by Next.js — see the digest below to correlate with
          server logs; client-side errors show their real message here):
        </p>
        <pre className="error-fallback-pre">
          {error.message || '(no error message)'}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
        <button type="button" onClick={() => reset()} className="error-fallback-button">
          Try again
        </button>
      </div>
    </main>
  );
}
