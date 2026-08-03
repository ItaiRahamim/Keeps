'use client';

// Video handling is a two-step flow: the user scrubs a hidden <video> to pick
// a frame (useVideoScrubber), then that frame gets captured + encoded as the
// thumbnail once they confirm (captureVideoFrame). The original video's bytes
// are uploaded untouched — only the thumbnail is derived client-side.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { encodeThumbnail } from './canvas';
import type { ProcessedUpload } from './pipeline-types';

export type UseVideoScrubberResult = {
  videoRef: RefObject<HTMLVideoElement | null>;
  ready: boolean;
  duration: number;
  seek: (timeSec: number) => Promise<void>;
};

const HIDDEN_VIDEO_CSS =
  'position:fixed;left:-99999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';

/**
 * Mounts a hidden <video> from `file` and exposes a `seek()` the UI's
 * scrubber slider can call to land on an exact frame.
 *
 * iOS Safari gotchas handled here:
 *  - `muted`, `playsInline` (+ the legacy `webkit-playsinline` attribute) and
 *    `preload="metadata"` are all set BEFORE the source is assigned. Missing
 *    `playsInline` forces iOS into fullscreen playback; missing `muted` can
 *    block programmatic play(); without these, `loadedmetadata`/`seeked` may
 *    never fire reliably at all.
 *  - We play() then immediately pause() once, after metadata loads, to
 *    "prime" the decoder — on iOS Safari, seeking before any play/pause
 *    cycle can silently no-op or hand back a black frame.
 *  - seek() resolves on the `seeked` event only — never a setTimeout guess,
 *    which is a race that intermittently grabs the wrong (or still-decoding)
 *    frame.
 *  - EXTRA GOTCHA (not called out in the spec but hit while testing): iOS
 *    Safari has been observed to never fire `loadedmetadata`/`seeked` for a
 *    <video> element that only exists in memory and is never attached to the
 *    document — even fully off-screen, it must actually be inserted into the
 *    DOM (we use `document.body.appendChild`, hidden via CSS position/opacity
 *    rather than `display:none`, since some engines pause decode work for
 *    display:none media elements too).
 *  - The object URL is revoked on unmount so re-picking a video repeatedly in
 *    one session doesn't leak memory.
 */
export function useVideoScrubber(file: File | null | undefined): UseVideoScrubberResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);

  // Reset ready/duration synchronously during render (not from inside the
  // effect below) whenever `file` changes, following React's documented
  // "adjust state when a prop changes" pattern rather than setState-in-effect
  // — this avoids an extra commit+cascading-render and keeps `ready` honestly
  // false for the gap between picking a new file and its metadata loading.
  const [trackedFile, setTrackedFile] = useState(file);
  if (file !== trackedFile) {
    setTrackedFile(file);
    setReady(false);
    setDuration(0);
  }

  useEffect(() => {
    videoRef.current = null;

    if (!file) return;

    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.style.cssText = HIDDEN_VIDEO_CSS;

    document.body.appendChild(video);
    videoRef.current = video;

    const primeDecoderThenReady = async () => {
      try {
        await video.play();
        video.pause();
      } catch {
        // Autoplay can be rejected in some contexts (e.g. no user gesture
        // yet) — priming is best-effort; seeking still mostly works without
        // it, it's just more likely to be flaky on iOS.
      }
      if (!cancelled) setReady(true);
    };

    const handleLoadedMetadata = () => {
      if (cancelled) return;
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      void primeDecoderThenReady();
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.src = objectUrl;
    video.load();

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      URL.revokeObjectURL(objectUrl);
      videoRef.current = null;
    };
  }, [file]);

  const seek = useCallback((timeSec: number): Promise<void> => {
    const video = videoRef.current;
    if (!video) {
      return Promise.reject(new Error('useVideoScrubber: seek() called before the video is ready'));
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('useVideoScrubber: video element errored while seeking'));
      };
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);

      const max = Number.isFinite(video.duration) ? video.duration : timeSec;
      video.currentTime = Math.max(0, Math.min(timeSec, max));
    });
  }, []);

  return { videoRef, ready, duration, seek };
}

const VIDEO_MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
  'video/x-matroska': 'mkv',
};

function extFromVideoFile(file: File): string {
  if (file.type && VIDEO_MIME_TO_EXT[file.type]) return VIDEO_MIME_TO_EXT[file.type];
  const nameMatch = /\.([a-z0-9]+)$/i.exec(file.name);
  if (nameMatch) return nameMatch[1].toLowerCase();
  const mimeMatch = /^video\/([a-z0-9]+)/i.exec(file.type);
  if (mimeMatch) return mimeMatch[1].toLowerCase();
  return 'mp4';
}

/**
 * Captures the CURRENT frame of `video` (wherever the user last scrubbed to)
 * as the thumbnail, reads intrinsic duration/dimensions off the element, and
 * returns a ProcessedUpload whose `fileBlob` is the ORIGINAL video file
 * (videos upload their original bytes untouched — only the thumbnail is
 * derived from a drawn frame).
 */
export async function captureVideoFrame(video: HTMLVideoElement, file: File): Promise<ProcessedUpload> {
  const thumbnail = await encodeThumbnail(video);
  const durationSec = Number.isFinite(video.duration) ? video.duration : 0;

  return {
    mediaType: 'video',
    fileBlob: file,
    ext: extFromVideoFile(file),
    contentType: file.type || 'video/mp4',
    thumbnail,
    lat_lng: null,
    width: video.videoWidth || null,
    height: video.videoHeight || null,
    duration_ms: Math.round(durationSec * 1000),
  };
}
