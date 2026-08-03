// Groups a flat list of MediaRow into "board items": either a lone photo/
// video (rendered exactly as today) or a small "album" — a cluster of media
// captured on the same calendar day *and* at a similar GPS location.
//
// This is a pure function of `MediaRow[]` (no DOM/React/Next dependency), so
// it's trivially unit-testable and safe to call from a Client Component
// (`Corkboard.tsx`) on every render without worrying about SSR/hydration
// drift — same input array in, same grouping out, every time.
//
// NOTE on `captured_at`: this field is being added to `MediaRow` by a
// parallel agent (see AGENTS.md's "contract" section). This file is written
// against that contract now. Until it lands, `tsc`/`next build` will fail
// here with a "Property 'captured_at' does not exist on type 'MediaRow'"
// error — that is expected/transient, not a bug in this file.

import type { MediaRow } from '@/lib/types';

export type BoardItem =
  | { kind: 'single'; media: MediaRow }
  | { kind: 'album'; id: string; items: MediaRow[] };

// ---------------------------------------------------------------------------
// Tunables — documented per AGENTS.md's ask ("document your chosen threshold
// and reasoning in a comment").
// ---------------------------------------------------------------------------

/**
 * Max great-circle distance (meters) between two items for them to be
 * considered "the same place" for clustering purposes.
 *
 * Chosen as a middle point of the suggested "a few hundred meters to ~1km"
 * range: large enough to cover one venue/neighborhood block (a museum, a
 * park, a wedding venue plus its parking lot/garden) even though consumer
 * GPS/EXIF location fixes commonly carry 10-50m of their own error, but
 * small enough that it won't chain together stops on a day-long city trip
 * (a morning at one neighborhood and an afternoon across town should NOT
 * become one album just because both happened on the same date).
 */
const ALBUM_DISTANCE_THRESHOLD_M = 750;

/**
 * Minimum number of items for a cluster to be rendered as an "album" stack
 * rather than plain singles.
 *
 * A pair (2 items) that happen to share a day and a rough location is easy
 * to produce by coincidence (e.g. two unrelated errands near home on the
 * same afternoon) and doesn't yet feel like a deliberate "photo essay" --
 * two singles sitting near each other on the board already communicate that
 * fine without the extra stack/expand UI. 3+ is where the stack affordance
 * (hiding N-1 cards behind a badge) starts actually paying for its own
 * complexity, so that's the threshold used here.
 */
const MIN_ALBUM_SIZE = 3;

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle (haversine) distance in meters between two lat/lng points.
 *
 * Deliberately NOT naive Euclidean distance on raw degree values: a degree
 * of longitude shrinks toward the poles (`cos(latitude)` scaling), so
 * treating (lat, lng) as a flat Cartesian plane would under-count east/west
 * distance increasingly the further a family is from the equator (which,
 * for essentially all plausible users of this app, is "always, and quite a
 * lot"). Haversine accounts for the sphere properly at negligible extra
 * cost for the tiny item counts this runs over.
 */
function haversineDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

/**
 * Calendar-day bucket key for a media row.
 *
 * Prefers `captured_at` (real EXIF `DateTimeOriginal`) but falls back to
 * `created_at` (upload time) when `captured_at` is null — per AGENTS.md,
 * "not every upload will have EXIF, especially HEIC-transcoded images per
 * the pipeline's own documented behavior, and this must not force
 * everything into 'unclustered' just because EXIF was missing." Videos
 * never carry `captured_at` either and always fall back the same way.
 *
 * Uses UTC calendar components rather than the browser's local timezone:
 * this function must return the same key on the server render and the
 * client hydration pass (different machines can have different TZ
 * configuration), and a family's photos may span timezones on a trip, so
 * there's no single "correct" local timezone to prefer anyway. UTC just
 * needs to be *consistent*, not "correct" for any particular viewer.
 */
function dayKey(media: MediaRow): string | null {
  const iso = media.captured_at ?? media.created_at;
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * Deterministic ordering used both to pick an album's "cover" (first item)
 * and to keep an album's `items` array stable across renders regardless of
 * the input array's original order: sort by capture time (falling back to
 * upload time, same rule as `dayKey`), tie-broken by `id` so ordering is
 * fully deterministic even when two items share an identical timestamp.
 */
function albumSortComparator(a: MediaRow, b: MediaRow): number {
  const aTime = a.captured_at ?? a.created_at;
  const bTime = b.captured_at ?? b.created_at;
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** Minimal union-find (disjoint-set) for grouping items by pairwise proximity. */
class UnionFind {
  private parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    // Path compression.
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Groups media into board items per the PRD: photos/videos captured on the
 * same calendar day AND within `ALBUM_DISTANCE_THRESHOLD_M` of each other
 * become one "album"; everything else renders as a plain single card.
 *
 * Algorithm, per calendar-day bucket:
 * 1. Only items that HAVE `lat_lng` participate in clustering at all — per
 *    AGENTS.md's steer ("lean toward requiring both signals rather than
 *    either alone"), an item with no location is never force-clustered by
 *    date alone, no matter how many same-day photos exist. It always renders
 *    as a single. (This is why videos, which currently never get EXIF/GPS,
 *    correctly end up singleton under this rule today — expected, not a
 *    bug, and it'll naturally start participating once video GPS lands.)
 * 2. Among the day's geotagged items, connect any pair within the distance
 *    threshold (union-find / single-linkage clustering). This is
 *    deliberately transitive: if A-B and B-C are each within threshold, all
 *    three merge into one album even if A-C alone would exceed it. For a
 *    family wandering around a single venue/day-trip this is exactly the
 *    desired behavior (a slow drift across a park or museum should still be
 *    "one album"); the trade-off is a pathological chain of items could in
 *    principle span further than the threshold end-to-end. With a ~750m
 *    threshold and real-world usage patterns (a handful of stops per day at
 *    most) this is judged an acceptable, even desirable, property rather
 *    than a bug.
 * 3. Connected components smaller than `MIN_ALBUM_SIZE` are dissolved back
 *    into plain singles rather than rendered as a stack.
 *
 * Output order: singles and albums are returned in the order their
 * underlying day-buckets/components were discovered while scanning `media`
 * in its given order, followed by all non-geotagged/no-date-key items at
 * the end. Order has no semantic meaning to the caller (Corkboard positions
 * everything absolutely via pos_x/pos_y) — only each `BoardItem`'s own
 * identity/contents matter, and those are fully deterministic.
 */
export function groupIntoAlbums(media: MediaRow[]): BoardItem[] {
  const dayBuckets = new Map<string, MediaRow[]>();
  const ungrouped: MediaRow[] = [];

  for (const item of media) {
    const key = dayKey(item);
    if (!key || !item.lat_lng) {
      ungrouped.push(item);
      continue;
    }
    const bucket = dayBuckets.get(key);
    if (bucket) bucket.push(item);
    else dayBuckets.set(key, [item]);
  }

  const result: BoardItem[] = [];

  for (const bucket of dayBuckets.values()) {
    if (bucket.length < MIN_ALBUM_SIZE) {
      // Not even enough same-day, geotagged items to reach the minimum —
      // skip the O(n^2) distance pass entirely.
      for (const item of bucket) result.push({ kind: 'single', media: item });
      continue;
    }

    const uf = new UnionFind();
    for (const item of bucket) uf.add(item.id);

    for (let i = 0; i < bucket.length; i++) {
      const a = bucket[i];
      // Both guaranteed non-null here (only geotagged items enter `bucket`).
      const aPoint = { lat: a.lat_lng!.y, lng: a.lat_lng!.x };
      for (let j = i + 1; j < bucket.length; j++) {
        const b = bucket[j];
        const bPoint = { lat: b.lat_lng!.y, lng: b.lat_lng!.x };
        if (haversineDistanceMeters(aPoint, bPoint) <= ALBUM_DISTANCE_THRESHOLD_M) {
          uf.union(a.id, b.id);
        }
      }
    }

    const components = new Map<string, MediaRow[]>();
    for (const item of bucket) {
      const root = uf.find(item.id);
      const group = components.get(root);
      if (group) group.push(item);
      else components.set(root, [item]);
    }

    for (const group of components.values()) {
      if (group.length >= MIN_ALBUM_SIZE) {
        const sorted = [...group].sort(albumSortComparator);
        // Stable id derived from the (deterministically chosen) cover
        // item's own id, prefixed so it can never collide with a real
        // media id used as a React key elsewhere on the board.
        result.push({ kind: 'album', id: `album-${sorted[0].id}`, items: sorted });
      } else {
        for (const item of group) result.push({ kind: 'single', media: item });
      }
    }
  }

  for (const item of ungrouped) result.push({ kind: 'single', media: item });

  return result;
}
