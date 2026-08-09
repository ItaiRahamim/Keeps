// Groups a flat list of MediaRow into "board items": either a lone photo/
// video (rendered exactly as today) or an "album". Explicit memory tags have
// first priority; only untagged media falls back to EXIF day/location rules.
//
// This is a pure function of `MediaRow[]` (no DOM/React/Next dependency), so
// it's trivially unit-testable and safe to call from a Client Component
// (`Corkboard.tsx`) on every render without worrying about SSR/hydration
// drift — same input array in, same grouping out, every time.
//
import type { MediaRow } from '@/lib/types';

export type BoardItem =
  | { kind: 'single'; media: MediaRow }
  | { kind: 'album'; id: string; items: MediaRow[] };

export type LibraryAlbumGroup = {
  kind: 'album' | 'loose';
  id: string;
  items: MediaRow[];
};

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

/**
 * Canonical comparison key for manual albums. NFKC prevents visually
 * equivalent Unicode forms from splitting, whitespace normalization makes
 * accidental spacing harmless, and lower-casing makes matching
 * case-insensitive. The original, storage-normalized `memory_tag` remains on
 * each row so UI can preserve the user's display casing.
 */
export function normalizeMemoryTag(tag: string | null): string | null {
  const normalized = tag?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized || null;
}

export type BoardPosition = { x: number; y: number };

/**
 * Picks the persisted starting position for a newly uploaded tagged memory.
 * Existing photos are deliberately never moved: a tag only influences this
 * one initial placement, after which the board remains entirely user-driven.
 *
 * The center is the centroid of the matching tag's current saved positions.
 * A deterministic golden-angle orbit gives each newcomer a visibly separate
 * spot around that center instead of stacking every tagged item at one exact
 * coordinate. The radius is bounded, so an album still reads as one loose
 * spatial cluster rather than spreading across the full board.
 */
export function getTaggedDropPosition(
  media: MediaRow[],
  memoryTag: string | null,
  fallback: BoardPosition,
  surfaceSize = 4000
): BoardPosition {
  const tagKey = normalizeMemoryTag(memoryTag);
  if (!tagKey) return fallback;

  const siblings = media.filter((item) => normalizeMemoryTag(item.memory_tag) === tagKey);
  if (siblings.length === 0) return fallback;

  const center = siblings.reduce(
    (sum, item) => ({ x: sum.x + item.pos_x, y: sum.y + item.pos_y }),
    { x: 0, y: 0 }
  );
  center.x /= siblings.length;
  center.y /= siblings.length;

  // Six cards per loose ring, with a small ring expansion for larger tagged
  // albums. The hard cap keeps every tagged set visually cohesive.
  const ring = Math.floor(siblings.length / 6);
  const radius = Math.min(420, 190 + ring * 72);
  const seed = [...tagKey].reduce((hash, char) => ((hash * 31 + char.charCodeAt(0)) >>> 0), 2166136261);
  const angle = (seed % 360) * (Math.PI / 180) + siblings.length * 2.399963229728653;

  // Approximate card extents keep the whole Polaroid reachable at board
  // edges without introducing drop-time snapping anywhere else.
  const min = 28;
  const maxX = Math.max(min, surfaceSize - 250);
  const maxY = Math.max(min, surfaceSize - 330);
  return {
    x: Math.min(maxX, Math.max(min, center.x + Math.cos(angle) * radius)),
    y: Math.min(maxY, Math.max(min, center.y + Math.sin(angle) * radius * 0.78)),
  };
}

function taggedAlbumId(tagKey: string): string {
  // encodeURIComponent is deterministic and one-to-one for the normalized
  // string, unlike a short hash which could merge two unrelated tag names.
  return `album-tag-${encodeURIComponent(tagKey)}`;
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
 * Groups media into board items per the PRD. A non-empty manual `memory_tag`
 * always wins: all rows with the same normalized tag become one exact album,
 * independent of EXIF, location, or the automatic minimum size. This means
 * a tagged singleton/pair is intentionally still an album — adding a tag is
 * explicit user intent. Only untagged rows enter the existing automatic
 * same-day + nearby-location algorithm below.
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
 * Output order: manual albums appear in tag-bucket discovery order, followed
 * by automatic singles/albums in their underlying day/component discovery
 * order, then non-geotagged/no-date-key items. Order has no semantic meaning
 * to the caller (Corkboard positions everything absolutely via pos_x/pos_y)
 * — only each `BoardItem`'s own identity/contents matter, and those are fully
 * deterministic.
 */
export function groupIntoAlbums(media: MediaRow[]): BoardItem[] {
  const taggedBuckets = new Map<string, MediaRow[]>();
  const dayBuckets = new Map<string, MediaRow[]>();
  const ungrouped: MediaRow[] = [];

  for (const item of media) {
    const tagKey = normalizeMemoryTag(item.memory_tag);
    if (tagKey) {
      const taggedBucket = taggedBuckets.get(tagKey);
      if (taggedBucket) taggedBucket.push(item);
      else taggedBuckets.set(tagKey, [item]);
      continue;
    }

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

  for (const [tagKey, bucket] of taggedBuckets) {
    result.push({
      kind: 'album',
      id: taggedAlbumId(tagKey),
      items: [...bucket].sort(albumSortComparator),
    });
  }

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

/**
 * Canonical album identity used by both the library and URL destinations.
 * Loose memories remain navigable as one-item albums using the same id the
 * corkboard library has always assigned them.
 */
export function groupIntoLibraryAlbums(media: MediaRow[]): LibraryAlbumGroup[] {
  return groupIntoAlbums(media).map((item) =>
    item.kind === 'album'
      ? { kind: 'album', id: item.id, items: item.items }
      : { kind: 'loose', id: `album-loose-${item.media.id}`, items: [item.media] }
  );
}
