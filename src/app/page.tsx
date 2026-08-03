import Corkboard from '@/components/corkboard/Corkboard';
import { getClusters, getMedia } from '@/lib/media/actions';
import type { ClusterRow, MediaRow } from '@/lib/types';
import '@/components/corkboard/cork-texture.css';
import './error-fallback.css';

// Authenticated home page — the proxy (src/proxy.ts) already redirects
// unauthenticated visitors to /login before this ever renders.
//
// Composition note for the integration pass: `<Corkboard>` itself mounts
// the upload FAB/modal (`<UploadSheet>`) internally, rather than this file
// rendering the two as separate siblings. This page is a Server Component
// and can't hold the shared client state needed to splice a freshly
// uploaded row into the board's live item list — Corkboard is the client
// component that owns that state, so it's the natural place to wire
// "upload completes -> appears on the board" together.

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ? `${err.message}\n\n${err.stack}` : err.message;
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

// Next.js uses thrown errors tagged with a special `digest` as its own
// internal control-flow signaling — `redirect()`/`notFound()`, and (verified
// directly against this exact build: see the "DYNAMIC_SERVER_USAGE" digest
// that surfaced in `next build`'s output the first time this try/catch was
// added) the bailout-to-dynamic-rendering probe that runs during
// `next build`'s "Generating static pages" step, since this route calls
// `cookies()` (via getMedia()/getClusters() -> createClient()). A bare
// try/catch around those calls would swallow this signal along with real
// errors, which risks confusing Next's static/dynamic detection for this
// route in the general case — so anything carrying one of these digests
// must be re-thrown untouched rather than turned into fallback UI.
function isNextInternalControlFlowError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === 'string' &&
    (digest === 'DYNAMIC_SERVER_USAGE' ||
      digest.startsWith('NEXT_REDIRECT') ||
      digest.startsWith('NEXT_NOT_FOUND') ||
      digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'))
  );
}

export default async function Page() {
  let media: MediaRow[];
  let clusters: ClusterRow[];

  try {
    [media, clusters] = await Promise.all([getMedia(), getClusters()]);
  } catch (err) {
    if (isNextInternalControlFlowError(err)) throw err;

    // Defensive fallback: if `getMedia()`/`getClusters()` throw (e.g. a
    // stale/expired session token in this specific per-request server
    // Supabase client — see src/lib/supabase/server.ts — a scenario distinct
    // from proxy.ts's own separate session-refresh pass), don't just let the
    // whole Server Component error out to `error.tsx`. Next.js redacts the
    // real `Error#message` for anything thrown in a Server Component before
    // it's allowed to reach a client-rendered error boundary in production
    // (replacing it with a generic message + a `digest` id — see
    // node_modules/next/dist/docs/.../error.md). Catching it HERE and
    // rendering the real message as plain page content sidesteps that
    // redaction entirely, so if this exact bug recurs the actual diagnostic
    // text is visible on screen instead of a blank board or a generic
    // "Something went wrong."
    console.error('Page: failed to load media/clusters', err);
    return (
      <main className="relative flex-1 cork-texture error-fallback-main">
        <div className="error-fallback-card">
          <h1 className="error-fallback-title">Couldn&apos;t load the board</h1>
          <p className="error-fallback-lede">
            Fetching your photos failed with this error (shown verbatim, not redacted):
          </p>
          <pre className="error-fallback-pre">{describeError(err)}</pre>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex-1">
      <Corkboard media={media} clusters={clusters} />
    </main>
  );
}
