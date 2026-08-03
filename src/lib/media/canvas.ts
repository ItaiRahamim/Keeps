// Canvas-based thumbnail + LQIP encoding. Pure browser utility module — no
// React involved, safe to import from anywhere as long as it's only ever
// *called* client-side (drawImage/canvas/document are only touched inside
// function bodies, never at module scope).

import type { ProcessedThumbnail } from './pipeline-types';

/**
 * Anything we can draw a still frame from. A decoded <img>, an already-drawn
 * <canvas>, or a <video> paused/seeked to the frame we want — once drawn,
 * a video frame is conceptually identical to a still image.
 */
export type ThumbnailSource = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

export type EncodeThumbnailOptions = {
  /** Longest-edge cap for the main thumbnail, in px. Default ~800. */
  maxEdge?: number;
  /** canvas.toBlob quality (0-1) for the main thumbnail. Default 0.82. */
  quality?: number;
  /** Longest-edge cap for the LQIP blur-up placeholder, in px. Default ~20. */
  lqipMaxEdge?: number;
  /** canvas.toDataURL quality (0-1) for the LQIP. Default 0.5. */
  lqipQuality?: number;
};

const DEFAULT_MAX_EDGE = 800;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_LQIP_MAX_EDGE = 20;
const DEFAULT_LQIP_QUALITY = 0.5;

let webpSupportPromise: Promise<boolean> | null = null;

/**
 * Feature-detects whether this browser's canvas.toBlob can actually encode
 * WebP. Per spec, an unsupported `type` passed to toBlob/toDataURL silently
 * falls back to image/png instead of throwing (this bit Safari < 14, which
 * has no canvas WebP encoder) — so we can't detect support by catching an
 * exception, we have to inspect the *resulting* blob's mime type. Cached
 * after the first check since it can never change during a page session.
 */
export function supportsCanvasWebp(): Promise<boolean> {
  if (!webpSupportPromise) {
    webpSupportPromise = new Promise((resolve) => {
      try {
        const probe = document.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        probe.toBlob((blob) => resolve(!!blob && blob.type === 'image/webp'), 'image/webp');
      } catch {
        resolve(false);
      }
    });
  }
  return webpSupportPromise;
}

function getSourceDimensions(source: ThumbnailSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  const img = source as HTMLImageElement;
  return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

function computeScaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawToCanvas(source: ThumbnailSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('encodeThumbnail: 2D canvas context unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`encodeThumbnail: canvas.toBlob produced no blob for ${type}`))),
      type,
      quality,
    );
  });
}

/**
 * Draws `source` down to ~800px longest edge and encodes it as WebP (or JPEG
 * if this browser's canvas can't export WebP — see supportsCanvasWebp), plus
 * a second ~20px longest-edge version inlined as a base64 data: URI for a
 * blur-up placeholder (LQIP).
 */
export async function encodeThumbnail(
  source: ThumbnailSource,
  opts: EncodeThumbnailOptions = {},
): Promise<ProcessedThumbnail> {
  const {
    maxEdge = DEFAULT_MAX_EDGE,
    quality = DEFAULT_QUALITY,
    lqipMaxEdge = DEFAULT_LQIP_MAX_EDGE,
    lqipQuality = DEFAULT_LQIP_QUALITY,
  } = opts;

  const { width: srcWidth, height: srcHeight } = getSourceDimensions(source);
  if (!srcWidth || !srcHeight) {
    throw new Error('encodeThumbnail: source has no intrinsic dimensions (not loaded/decoded yet?)');
  }

  const useWebp = await supportsCanvasWebp();
  const mimeType = useWebp ? 'image/webp' : 'image/jpeg';

  const { width, height } = computeScaledSize(srcWidth, srcHeight, maxEdge);
  const canvas = drawToCanvas(source, width, height);
  const blob = await canvasToBlob(canvas, mimeType, quality);

  const lqipSize = computeScaledSize(srcWidth, srcHeight, lqipMaxEdge);
  const lqipCanvas = drawToCanvas(source, lqipSize.width, lqipSize.height);
  const lqip = lqipCanvas.toDataURL(mimeType, lqipQuality);

  return { blob, lqip, width, height };
}
