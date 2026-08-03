// EXIF extraction (GPS + dimensions) via exifr. Runs entirely client-side —
// never send the raw file to a server just to read its EXIF tags.

import * as exifr from 'exifr';

export type ImageExifMeta = {
  lat_lng: { x: number; y: number } | null;
  width: number | null;
  height: number | null;
  captured_at: string | null;
};

/**
 * EXIF `DateTimeOriginal` (tag 0x9003) — and its `DateTimeDigitized` sibling
 * (tag 0x9004, which exifr's dictionary names `CreateDate`) — are ASCII
 * strings of the form `YYYY:MM:DD HH:MM:SS` with NO timezone info: it's
 * just the camera's local wall-clock time at the moment of capture.
 *
 * exifr's default (`reviveValues: true`) behavior converts this into a JS
 * `Date` via `new Date(year, month - 1, day)` + `.setHours/.setMinutes/
 * .setSeconds` — see `node_modules/exifr/src/dicts/tiff-revivers.mjs`'s
 * `reviveDate`. Those are all *local* (host-timezone) setters, so the
 * resulting `Date` only round-trips the original wall-clock digits if you
 * read it back with local getters. Calling `.toISOString()` on it directly
 * would silently reinterpret those digits through whatever timezone the
 * device processing the upload happens to be in — verified empirically
 * against a JPEG with `DateTimeOriginal = "2024:06:15 14:30:07"`:
 *   TZ=UTC              -> .toISOString() = 2024-06-15T14:30:07.000Z (looks right, coincidence)
 *   TZ=Asia/Jerusalem    -> .toISOString() = 2024-06-15T11:30:07.000Z (wrong, -3h)
 *   TZ=Pacific/Kiritimati -> .toISOString() = 2024-06-15T00:30:07.000Z (wrong, -14h)
 *   TZ=Pacific/Midway    -> .toISOString() = 2024-06-16T01:30:07.000Z (wrong, rolls to next day)
 * There's no correct conversion to apply anyway, since EXIF never recorded
 * an offset — any such shift just corrupts the recorded time. It's also
 * DST-unsafe: local Date setters can silently normalize a wall-clock time
 * that doesn't exist locally (spring-forward gaps) to a different instant.
 *
 * We sidestep all of this by requesting `reviveValues: false` so exifr
 * hands back the raw ASCII string, and parsing it ourselves. The resulting
 * ISO string's date/time digits are then guaranteed to exactly match what's
 * in the file, independent of host timezone/DST — confirmed with the same
 * fixture above (all four TZs above produced 2024-06-15T14:30:07.000Z).
 * The trailing "Z" is just an ISO 8601 / Postgres `timestamptz`-compatible
 * encoding of those wall-clock digits, not a claim the photo was taken in
 * UTC — the same "preserve local time verbatim" convention most photo
 * tooling falls back to when EXIF carries no offset.
 */
const EXIF_DATETIME_RE = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

function parseExifDateTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = EXIF_DATETIME_RE.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds] = match;
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.000Z`;
}

/**
 * Axis convention (IMPORTANT — a flipped lat/lng is a silent, hard-to-catch
 * bug): Postgres `point` is `(x, y)`. We map GPS as
 *   lat_lng.x = longitude (east/west, horizontal)
 *   lat_lng.y = latitude  (north/south, vertical)
 * i.e. `{ x: lng, y: lat }` — the same [lng, lat] axis order GeoJSON and most
 * map libraries use for (x, y)/(easting, northing) style coordinates. Every
 * reader of MediaRow.lat_lng must follow this same convention.
 */
export async function extractImageMeta(file: File): Promise<ImageExifMeta> {
  try {
    const [gps, tags, dateTags] = await Promise.all([
      exifr.gps(file).catch(() => null),
      exifr
        .parse(file, {
          pick: ['ExifImageWidth', 'ExifImageHeight', 'PixelXDimension', 'PixelYDimension', 'ImageWidth', 'ImageHeight'],
        })
        .catch(() => null),
      // Separate call, `reviveValues: false` — see the block comment above
      // parseExifDateTime for why dates need to bypass exifr's default
      // Date-revival. (Kept separate from the dimensions call above because
      // `reviveValues` is a call-wide option and ExifImageWidth/Height *do*
      // rely on a reviver — `unwrapExifSizeArray` — to come back as plain
      // numbers instead of arrays; disabling it there would break them.)
      exifr
        .parse(file, {
          pick: ['DateTimeOriginal', 'CreateDate'],
          reviveValues: false,
        })
        .catch(() => null),
    ]);

    const lat_lng =
      gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number'
        ? { x: gps.longitude, y: gps.latitude }
        : null;

    const rawWidth = tags?.ExifImageWidth ?? tags?.PixelXDimension ?? tags?.ImageWidth ?? null;
    const rawHeight = tags?.ExifImageHeight ?? tags?.PixelYDimension ?? tags?.ImageHeight ?? null;

    // DateTimeOriginal (moment the shutter opened) is preferred; CreateDate
    // (DateTimeDigitized — moment the image was digitized) is only used as
    // a fallback when DateTimeOriginal is absent. For straight-from-camera
    // photos the two are identical; CreateDate only diverges for scanned
    // film, which is a reasonable approximation of "original capture time"
    // to fall back to rather than leaving the field null. We deliberately
    // do NOT fall back further to ModifyDate (IFD0 tag 0x0132) — that's a
    // last-saved/last-edited timestamp, not a capture time, and using it
    // would silently produce wrong data for re-saved/re-shared files.
    const captured_at = parseExifDateTime(dateTags?.DateTimeOriginal) ?? parseExifDateTime(dateTags?.CreateDate);

    return {
      lat_lng,
      width: typeof rawWidth === 'number' ? rawWidth : null,
      height: typeof rawHeight === 'number' ? rawHeight : null,
      captured_at,
    };
  } catch {
    // Many app-processed images (screenshots, re-saved/re-shared photos,
    // stripped-metadata exports) simply have no EXIF at all — that's normal,
    // not an error condition, so we return nulls rather than throwing.
    return { lat_lng: null, width: null, height: null, captured_at: null };
  }
}
