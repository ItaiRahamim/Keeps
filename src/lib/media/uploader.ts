// Direct-to-R2 upload orchestrator. Presigns two URLs (original + thumbnail)
// against the Backend & Storage agent's /api/uploads/presign route, then PUTs
// both blobs straight to R2 via XMLHttpRequest — the raw bytes never pass
// through a Next.js route handler.

import { PresignRequest, PresignResponse, type PresignResponseT } from '@/lib/contracts';
import type { ProcessedUpload } from './pipeline-types';

export type UploadResult = {
  originalKey: string;
  originalUrl: string;
  thumbnailKey: string;
  thumbnailUrl: string;
};

const PRESIGN_ENDPOINT = '/api/uploads/presign';
const MAX_PUT_ATTEMPTS = 2; // 1 initial try + 1 retry
const RETRY_BASE_DELAY_MS = 500;

const THUMBNAIL_MIME_TO_EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

function thumbnailExt(mime: string): string {
  return THUMBNAIL_MIME_TO_EXT[mime] ?? 'jpg';
}

function isAbortError(err: unknown): err is DOMException {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function presign(
  contentType: string,
  ext: string,
  kind: 'original' | 'thumbnail',
  signal?: AbortSignal,
): Promise<PresignResponseT> {
  const body = PresignRequest.parse({ contentType, ext, kind });
  const res = await fetch(PRESIGN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Presign request failed for ${kind} (HTTP ${res.status})`);
  }
  return PresignResponse.parse(await res.json());
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * PUTs `blob` to `url` via XMLHttpRequest (not fetch) so we get real `progress`
 * events for the upload bar. `onBytesLoaded` is called with the cumulative
 * bytes uploaded so far for THIS blob.
 */
function putOnce(
  url: string,
  blob: Blob,
  contentType: string,
  onBytesLoaded: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', contentType);

    const onAbort = () => xhr.abort();
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort);
      }
    }
    const detach = () => signal?.removeEventListener('abort', onAbort);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onBytesLoaded(event.loaded);
    };
    xhr.onload = () => {
      detach();
      if (xhr.status >= 200 && xhr.status < 300) {
        onBytesLoaded(blob.size);
        resolve();
      } else {
        reject(new Error(`Upload PUT failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      detach();
      reject(new Error('Upload PUT failed due to a network error'));
    };
    xhr.onabort = () => {
      detach();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    xhr.send(blob);
  });
}

/** One retry with exponential backoff — R2/network blips shouldn't force the
 * user to re-pick and re-process the whole file. A user-triggered abort is
 * never retried. */
async function putWithRetry(
  url: string,
  blob: Blob,
  contentType: string,
  onBytesLoaded: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt++) {
    try {
      await putOnce(url, blob, contentType, onBytesLoaded, signal);
      return;
    } catch (err) {
      lastError = err;
      if (isAbortError(err)) throw err;
      if (attempt < MAX_PUT_ATTEMPTS) {
        onBytesLoaded(0); // reset this blob's contribution to the aggregate before retrying
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), signal);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Upload PUT failed');
}

/**
 * Uploads a processed original + thumbnail directly to R2.
 *
 * Cancellation: pass an `AbortSignal` as the third argument (e.g. from an
 * `AbortController` the caller owns) rather than a returned cancel() handle —
 * this is the standard web-platform pattern and composes natively with both
 * the presign `fetch` calls and the `XMLHttpRequest` PUTs. Aborting rejects
 * the returned promise with a `DOMException` named `'AbortError'`.
 *
 * `onProgress` is called with an aggregate 0-100 across both PUTs, weighted
 * by each blob's byte size.
 */
export async function uploadProcessedMedia(
  processed: ProcessedUpload,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const thumbnailContentType = processed.thumbnail.blob.type || 'image/webp';

  const [originalPresign, thumbnailPresign] = await Promise.all([
    presign(processed.contentType, processed.ext, 'original', signal),
    presign(thumbnailContentType, thumbnailExt(thumbnailContentType), 'thumbnail', signal),
  ]);

  if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

  const originalSize = processed.fileBlob.size || 1;
  const thumbnailSize = processed.thumbnail.blob.size || 1;
  const totalSize = originalSize + thumbnailSize;

  let originalLoaded = 0;
  let thumbnailLoaded = 0;
  const report = () => {
    if (!onProgress) return;
    const pct = ((originalLoaded + thumbnailLoaded) / totalSize) * 100;
    onProgress(Math.max(0, Math.min(100, pct)));
  };

  await Promise.all([
    putWithRetry(
      originalPresign.putUrl,
      processed.fileBlob,
      processed.contentType,
      (loaded) => {
        originalLoaded = loaded;
        report();
      },
      signal,
    ),
    putWithRetry(
      thumbnailPresign.putUrl,
      processed.thumbnail.blob,
      thumbnailContentType,
      (loaded) => {
        thumbnailLoaded = loaded;
        report();
      },
      signal,
    ),
  ]);

  return {
    originalKey: originalPresign.key,
    originalUrl: originalPresign.publicUrl,
    thumbnailKey: thumbnailPresign.key,
    thumbnailUrl: thumbnailPresign.publicUrl,
  };
}
