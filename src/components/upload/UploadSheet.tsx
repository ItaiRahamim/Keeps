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
  /** Called once all selected rows are fully created (and their DB-derived
   *  rotations patched in) so the caller can add the batch without reloads. */
  onCreated: (rows: MediaRow[]) => void;
  /** Asks the caller (Corkboard) for a reasonable pos_x/pos_y for a new
   *  card, in board-surface coordinates. */
  getDropPosition: (memoryTag: string | null) => { x: number; y: number };
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
  const [videoQueue, setVideoQueue] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [memoryTag, setMemoryTag] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setVideoFile(null);
    setVideoQueue([]);
    setCaption('');
    setMemoryTag('');
    setProgress(0);
    setError(null);
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const finishUploads = useCallback(
    async (processedBatch: ProcessedUpload[]): Promise<MediaRow[] | null> => {
      if (processedBatch.length === 0) return [];
      setStage('uploading');
      setProgress(0);
      setError(null);
      try {
        const progressByFile = processedBatch.map(() => 0);
        const uploadedBatch = await Promise.all(
          processedBatch.map((processed, index) =>
            uploadProcessedMedia(processed, (nextProgress) => {
              progressByFile[index] = nextProgress;
              const aggregate = progressByFile.reduce((total, current) => total + current, 0);
              setProgress(Math.round(aggregate / progressByFile.length));
            })
          )
        );
        const normalizedMemoryTag = memoryTag.normalize('NFKC').trim().replace(/\s+/g, ' ') || null;
        const createdBatch = await Promise.all(
          processedBatch.map((processed, index) => {
            const uploaded = uploadedBatch[index];
            const drop = getDropPosition(normalizedMemoryTag);

            return createMedia({
              media_type: processed.mediaType,
              original_url: uploaded.originalUrl,
              thumbnail_url: uploaded.thumbnailUrl,
              thumbnail_data: processed.thumbnail.lqip,
              caption: caption.trim() || null,
              memory_tag: normalizedMemoryTag,
              lat_lng: processed.lat_lng,
              captured_at: processed.captured_at,
              duration_ms: processed.duration_ms,
              width: processed.width,
              height: processed.height,
              pos_x: drop.x,
              pos_y: drop.y,
              rotation: 0,
            });
          })
        );

        const createdWithRotations = await Promise.all(
          createdBatch.map(async (created) => {
            const rotation = rotationForId(created.id);
            await updateMediaTransform(created.id, { rotation });
            return { ...created, rotation };
          })
        );

        onCreated(createdWithRotations);

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
        return createdWithRotations;
      } catch (err) {
        console.error('upload failed', err);
        setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
        setStage('error');
        return null;
      }
    },
    [caption, memoryTag, getDropPosition, onCreated, router]
  );

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) return;
      setError(null);

      const imageFiles = selectedFiles.filter((file) => !file.type.startsWith('video/'));
      const queuedVideos = selectedFiles.filter((file) => file.type.startsWith('video/'));

      if (imageFiles.length === 0 && queuedVideos.length > 0) {
        setVideoQueue(queuedVideos);
        setVideoFile(queuedVideos[0]);
        setStage('picked-video');
        return;
      }

      setStage('processing');
      try {
        const processedImages = await Promise.all(imageFiles.map((file) => processImageFile(file)));
        const created = await finishUploads(processedImages);
        if (!created) return;

        if (queuedVideos.length > 0) {
          setVideoQueue(queuedVideos);
          setVideoFile(queuedVideos[0]);
          setStage('picked-video');
        } else {
          closeSheet();
        }
      } catch (err) {
        console.error('processImageFile batch failed', err);
        setError(err instanceof Error ? err.message : 'Could not process the selected images.');
        setStage('error');
      }
    },
    [closeSheet, finishUploads]
  );

  const handleVideoCaptured = useCallback(
    async (processed: ProcessedUpload) => {
      const created = await finishUploads([processed]);
      if (!created) return;

      const remainingVideos = videoQueue.slice(1);
      if (remainingVideos.length > 0) {
        setVideoQueue(remainingVideos);
        setVideoFile(remainingVideos[0]);
        setStage('picked-video');
      } else {
        closeSheet();
      }
    },
    [closeSheet, finishUploads, videoQueue]
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
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length > 0) void handleFilesSelected(files);
                    e.target.value = '';
                  }}
                />
              </div>
            ) : null}

            {stage === 'picked-video' && videoFile ? (
              <VideoFramePicker
                file={videoFile}
                onCapture={handleVideoCaptured}
                onCancel={reset}
              />
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
  onCapture: (processed: ProcessedUpload) => Promise<void>;
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
              await onCapture(processed);
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
