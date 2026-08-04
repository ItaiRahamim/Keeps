'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MediaRow } from '@/lib/types';
import { createMedia, updateMediaTransform } from '@/lib/media/actions';
import { processImageFile } from '@/lib/media/image-pipeline';
import { captureVideoFrame, useVideoScrubber } from '@/lib/media/video-pipeline';
import { uploadProcessedMedia } from '@/lib/media/uploader';
import type { ProcessedUpload } from '@/lib/media/pipeline-types';
import { rotationForId } from '../lib/deterministic';
import './upload-sheet.css';

type Stage = 'idle' | 'picked-video' | 'processing' | 'uploading' | 'error';

export type UploadSheetProps = {
  /** Called once the row is fully created (and its DB-derived rotation
   *  patched in) so the caller can add it to the board without a reload. */
  onCreated: (row: MediaRow) => void;
  /** Asks the caller (Corkboard) for a reasonable pos_x/pos_y for a new
   *  card, in board-surface coordinates. */
  getDropPosition: () => { x: number; y: number };
};

/**
 * Self-contained upload flow: a floating action button that opens a modal
 * sheet. Images go straight from file-pick to upload; videos mount a scrub
 * slider so the user can choose a frame first. Both paths converge on the
 * same upload + createMedia (+ rotation patch) sequence.
 */
export default function UploadSheet({ onCreated, getDropPosition }: UploadSheetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [memoryTag, setMemoryTag] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setVideoFile(null);
    setCaption('');
    setMemoryTag('');
    setProgress(0);
    setError(null);
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const finishUpload = useCallback(
    async (processed: ProcessedUpload) => {
      setStage('uploading');
      setProgress(0);
      setError(null);
      try {
        const uploaded = await uploadProcessedMedia(processed, setProgress);
        const drop = getDropPosition();

        // `createMedia`'s input requires `rotation` up front, but the
        // deterministic per-card tilt (design-system.md §5) is a pure
        // function of the row's *server-assigned* `id`, which we only learn
        // once this call returns — chicken-and-egg. We insert with a 0deg
        // placeholder, then immediately patch the real value in below.
        // Note this patch is for DB consistency only: Polaroid.tsx derives
        // rotation from `id` directly at render time and never trusts this
        // column, so what's painted on screen is correct even in the brief
        // window before the patch lands.
        const created = await createMedia({
          media_type: processed.mediaType,
          original_url: uploaded.originalUrl,
          thumbnail_url: uploaded.thumbnailUrl,
          thumbnail_data: processed.thumbnail.lqip,
          caption: caption.trim() || null,
          memory_tag: memoryTag.normalize('NFKC').trim().replace(/\s+/g, ' ') || null,
          lat_lng: processed.lat_lng,
          captured_at: processed.captured_at,
          duration_ms: processed.duration_ms,
          width: processed.width,
          height: processed.height,
          pos_x: drop.x,
          pos_y: drop.y,
          rotation: 0,
        });

        const rotation = rotationForId(created.id);
        await updateMediaTransform(created.id, { rotation });

        onCreated({ ...created, rotation });
        closeSheet();

        // Defense-in-depth: `onCreated` above already splices the new row
        // into Corkboard's live client state, and `createMedia`/
        // `updateMediaTransform` already call `revalidatePath('/')` as
        // Server Actions, which should invalidate the Router Cache for this
        // route on its own. `router.refresh()` re-fetches this Server
        // Component's data from the server explicitly, so a real
        // server-side revalidation happens here too rather than relying
        // solely on the implicit Server Action revalidation behavior —
        // cheap, harmless, and closes any gap there even if it isn't the
        // primary cause of the reported blank-board bug.
        router.refresh();
      } catch (err) {
        console.error('upload failed', err);
        setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
        setStage('error');
      }
    },
    [caption, memoryTag, getDropPosition, onCreated, closeSheet, router]
  );

  const handleFileSelected = useCallback(
    async (file: File) => {
      setError(null);
      if (file.type.startsWith('video/')) {
        setVideoFile(file);
        setStage('picked-video');
        return;
      }
      setStage('processing');
      try {
        const processed = await processImageFile(file);
        await finishUpload(processed);
      } catch (err) {
        console.error('processImageFile failed', err);
        setError(err instanceof Error ? err.message : 'Could not process that image.');
        setStage('error');
      }
    },
    [finishUpload]
  );

  return (
    <>
      <button type="button" className="upload-fab" aria-label="Add photo or video" onClick={() => setOpen(true)}>
        +
      </button>

      {open ? (
        <div className="upload-sheet-backdrop" onClick={closeSheet}>
          <div className="upload-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="upload-sheet-header">
              <h2>Add a memory</h2>
              <button type="button" className="upload-sheet-close" onClick={closeSheet} aria-label="Close">
                &times;
              </button>
            </div>

            {stage === 'idle' ? (
              <div className="upload-sheet-body">
                <label className="upload-caption-label">
                  Caption
                  <input
                    className="upload-caption-input"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Write a little note…"
                  />
                </label>
                <label className="upload-memory-tag-label">
                  Memory or ticket name <span>Optional</span>
                  <input
                    className="upload-memory-tag-input"
                    value={memoryTag}
                    onChange={(e) => setMemoryTag(e.target.value)}
                    placeholder="Summer in Jaffa, concert tickets…"
                    maxLength={80}
                    autoComplete="off"
                  />
                  <small>Photos with the same name will share one album.</small>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFileSelected(file);
                    e.target.value = '';
                  }}
                />
              </div>
            ) : null}

            {stage === 'picked-video' && videoFile ? (
              <VideoFramePicker file={videoFile} onCapture={(processed) => void finishUpload(processed)} onCancel={reset} />
            ) : null}

            {stage === 'processing' ? <p className="upload-status">Processing…</p> : null}

            {stage === 'uploading' ? (
              <div className="upload-progress">
                <div className="upload-progress-track">
                  <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <p className="upload-status">Uploading… {progress}%</p>
              </div>
            ) : null}

            {stage === 'error' ? (
              <div className="upload-status-error">
                <p className="upload-status">{error ?? 'Something went wrong.'}</p>
                <button type="button" onClick={reset}>
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

type VideoFramePickerProps = {
  file: File;
  onCapture: (processed: ProcessedUpload) => void;
  onCancel: () => void;
};

/**
 * Mounts `useVideoScrubber` only once a video file has actually been picked
 * — kept as its own component (rather than an inline conditional hook call
 * in the parent) so the hook is always called unconditionally per
 * rules-of-hooks, with *mounting* being what's conditional.
 */
function VideoFramePicker({ file, onCapture, onCancel }: VideoFramePickerProps) {
  const { videoRef, ready, duration, seek } = useVideoScrubber(file);
  const [capturing, setCapturing] = useState(false);

  return (
    <div className="upload-sheet-body">
      <video ref={videoRef} muted playsInline className="upload-video-preview" />
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        disabled={!ready}
        onChange={(e) => void seek(Number(e.target.value))}
        aria-label="Scrub to a frame"
      />
      <div className="upload-sheet-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready || capturing}
          onClick={async () => {
            const video = videoRef.current;
            if (!video) return;
            setCapturing(true);
            try {
              const processed = await captureVideoFrame(video, file);
              onCapture(processed);
            } finally {
              setCapturing(false);
            }
          }}
        >
          Use this frame
        </button>
      </div>
    </div>
  );
}
