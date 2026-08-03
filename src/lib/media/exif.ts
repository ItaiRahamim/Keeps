// EXIF extraction (GPS + dimensions) via exifr. Runs entirely client-side —
// never send the raw file to a server just to read its EXIF tags.

import * as exifr from 'exifr';

export type ImageExifMeta = {
  lat_lng: { x: number; y: number } | null;
  width: number | null;
  height: number | null;
};

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
    const [gps, tags] = await Promise.all([
      exifr.gps(file).catch(() => null),
      exifr
        .parse(file, {
          pick: ['ExifImageWidth', 'ExifImageHeight', 'PixelXDimension', 'PixelYDimension', 'ImageWidth', 'ImageHeight'],
        })
        .catch(() => null),
    ]);

    const lat_lng =
      gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number'
        ? { x: gps.longitude, y: gps.latitude }
        : null;

    const rawWidth = tags?.ExifImageWidth ?? tags?.PixelXDimension ?? tags?.ImageWidth ?? null;
    const rawHeight = tags?.ExifImageHeight ?? tags?.PixelYDimension ?? tags?.ImageHeight ?? null;

    return {
      lat_lng,
      width: typeof rawWidth === 'number' ? rawWidth : null,
      height: typeof rawHeight === 'number' ? rawHeight : null,
    };
  } catch {
    // Many app-processed images (screenshots, re-saved/re-shared photos,
    // stripped-metadata exports) simply have no EXIF at all — that's normal,
    // not an error condition, so we return nulls rather than throwing.
    return { lat_lng: null, width: null, height: null };
  }
}
