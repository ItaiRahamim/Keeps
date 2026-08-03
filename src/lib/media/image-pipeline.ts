// Single entry point for turning a picked image File into a fully processed
// upload: HEIC detection/transcoding, EXIF extraction, and thumbnail/LQIP
// encoding, all client-side.

import { isHeic, transcodeHeic } from './heic';
import { extractImageMeta } from './exif';
import { encodeThumbnail } from './canvas';
import type { ProcessedUpload } from './pipeline-types';

const MIME_TO_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function extFromMime(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null;
}

function extFromFilename(name: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : null;
}

type LoadedImage = {
  element: HTMLImageElement;
  width: number;
  height: number;
  revoke: () => void;
};

async function loadImage(blob: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image-pipeline: failed to load image for thumbnail encoding'));
      img.src = url;
    });
    // Best-effort full decode before we draw to canvas (avoids partial-frame
    // draws in browsers that resolve `load` before decode fully settles).
    if (img.decode) {
      await img.decode().catch(() => {});
    }
    return { element: img, width: img.naturalWidth, height: img.naturalHeight, revoke: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Processes a picked image file end-to-end:
 *  1. Sniffs for HEIC (magic bytes) and transcodes to WebP/JPEG if needed.
 *  2. Extracts EXIF GPS + dimensions from the ORIGINAL file (HEIC transcoding
 *     via canvas strips all metadata, and exifr can't read the transcoded
 *     WebP/JPEG anyway — EXIF must come from the source bytes).
 *  3. Decodes the (possibly transcoded) blob and encodes an ~800px thumbnail
 *     + LQIP via canvas.ts.
 */
export async function processImageFile(file: File): Promise<ProcessedUpload> {
  const heic = await isHeic(file);

  let fileBlob: Blob = file;
  let contentType: string;
  let ext: string;

  if (heic) {
    fileBlob = await transcodeHeic(file);
    contentType = fileBlob.type || 'image/webp';
    ext = extFromMime(contentType) ?? 'webp';
  } else {
    contentType = file.type || `image/${extFromFilename(file.name) ?? 'jpeg'}`;
    ext = extFromMime(contentType) ?? extFromFilename(file.name) ?? 'jpg';
  }

  // Read EXIF from the original file, regardless of whether we transcoded.
  const { lat_lng, captured_at, width: exifWidth, height: exifHeight } = await extractImageMeta(file);

  const { element, width: decodedWidth, height: decodedHeight, revoke } = await loadImage(fileBlob);
  try {
    const thumbnail = await encodeThumbnail(element);

    return {
      mediaType: 'image',
      fileBlob,
      ext,
      contentType,
      thumbnail,
      lat_lng,
      captured_at,
      // Prefer the actually-decoded pixel dimensions (accounts for EXIF
      // orientation the way browsers auto-rotate <img> display) over the
      // EXIF-reported ones, falling back to EXIF only if decode somehow
      // failed to report dimensions.
      width: decodedWidth || exifWidth,
      height: decodedHeight || exifHeight,
      duration_ms: null,
    };
  } finally {
    revoke();
  }
}
