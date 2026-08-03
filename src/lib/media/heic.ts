// HEIC/HEIF detection + transcoding. `heic-to` is a WASM module, so it is
// ONLY ever dynamic-imported inside transcodeHeic() — never at module scope —
// to keep it out of the initial bundle. Callers must gate the call behind
// isHeic(file) resolving true.

import { supportsCanvasWebp } from './canvas';

/**
 * ISOBMFF brand strings that indicate a HEIC/HEIF container. iOS (and some
 * third-party apps) hand out files with HEIC-container bytes labeled with a
 * `.jpg` extension and `image/jpeg` MIME type, so extension/MIME sniffing
 * cannot be trusted — we sniff the actual magic bytes instead.
 */
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

const SNIFF_BYTES = 32;

function readAscii4(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Sniffs the first ~32 bytes of the file for an ISOBMFF `ftyp` box:
 * [4B box size][4B 'ftyp'][4B major brand][4B minor version][4B compatible brand]...
 * and checks whether the major brand or any compatible brand is one of the
 * HEIC/HEIF family brands. This never reads/decodes the rest of the file.
 */
export async function isHeic(file: File): Promise<boolean> {
  try {
    const buf = await file.slice(0, SNIFF_BYTES).arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length < 12 || readAscii4(bytes, 4) !== 'ftyp') return false;

    if (HEIC_BRANDS.has(readAscii4(bytes, 8))) return true;

    for (let offset = 16; offset + 4 <= bytes.length; offset += 4) {
      if (HEIC_BRANDS.has(readAscii4(bytes, offset))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Transcodes a HEIC/HEIF file to WebP, falling back to JPEG if this browser's
 * canvas can't encode WebP (e.g. Safari < 14). Only call this after
 * isHeic(file) has resolved true — it dynamic-imports the `heic-to` WASM
 * module so non-HEIC uploads never pay for it.
 */
export async function transcodeHeic(file: File): Promise<Blob> {
  const [{ heicTo }, useWebp] = await Promise.all([import('heic-to'), supportsCanvasWebp()]);
  return heicTo({ blob: file, type: useWebp ? 'image/webp' : 'image/jpeg', quality: 0.92 });
}
