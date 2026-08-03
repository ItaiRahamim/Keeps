import Corkboard from '@/components/corkboard/Corkboard';
import { getClusters, getMedia } from '@/lib/media/actions';

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
export default async function Page() {
  const [media, clusters] = await Promise.all([getMedia(), getClusters()]);

  return (
    <main className="relative flex-1">
      <Corkboard media={media} clusters={clusters} />
    </main>
  );
}
