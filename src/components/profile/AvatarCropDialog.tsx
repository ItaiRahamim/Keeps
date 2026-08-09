'use client';

import { useEffect, useRef, useState } from 'react';

type Point = { x: number; y: number };

type AvatarCropDialogProps = {
  file: File;
  previewUrl: string;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => Promise<void> | void;
};

const OUTPUT_SIZE = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function outputFilename(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `${base || 'avatar'}-cropped.jpg`;
}

export default function AvatarCropDialog({
  file,
  previewUrl,
  onCancel,
  onConfirm,
}: AvatarCropDialogProps) {
  const cropRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerId: number; origin: Point; start: Point } | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [cropSize, setCropSize] = useState(280);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const crop = cropRef.current;
    if (!crop) return;

    const measure = () => {
      const nextSize = crop.getBoundingClientRect().width;
      if (nextSize > 0) setCropSize(nextSize);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(crop);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isExporting) onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExporting, onCancel]);

  const baseScale =
    imageSize.width > 0 && imageSize.height > 0
      ? Math.max(cropSize / imageSize.width, cropSize / imageSize.height)
      : 1;
  const renderedWidth = imageSize.width * baseScale * zoom;
  const renderedHeight = imageSize.height * baseScale * zoom;
  const maxOffsetX = Math.max(0, (renderedWidth - cropSize) / 2);
  const maxOffsetY = Math.max(0, (renderedHeight - cropSize) / 2);

  function constrainedOffset(next: Point): Point {
    return {
      x: clamp(next.x, -maxOffsetX, maxOffsetX),
      y: clamp(next.y, -maxOffsetY, maxOffsetY),
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageSize.width || isExporting) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      origin: offset,
      start: { x: event.clientX, y: event.clientY },
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset(
      constrainedOffset({
        x: drag.origin.x + event.clientX - drag.start.x,
        y: drag.origin.y + event.clientY - drag.start.y,
      })
    );
  }

  function endPointerDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleZoom(nextZoom: number) {
    const safeZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const ratio = safeZoom / zoom;
    setZoom(safeZoom);
    setOffset((current) => {
      const nextRenderedWidth = imageSize.width * baseScale * safeZoom;
      const nextRenderedHeight = imageSize.height * baseScale * safeZoom;
      return {
        x: clamp(current.x * ratio, -(nextRenderedWidth - cropSize) / 2, (nextRenderedWidth - cropSize) / 2),
        y: clamp(current.y * ratio, -(nextRenderedHeight - cropSize) / 2, (nextRenderedHeight - cropSize) / 2),
      };
    });
  }

  function nudgeImage(event: React.KeyboardEvent<HTMLDivElement>) {
    const movement: Record<string, Point> = {
      ArrowLeft: { x: -4, y: 0 },
      ArrowRight: { x: 4, y: 0 },
      ArrowUp: { x: 0, y: -4 },
      ArrowDown: { x: 0, y: 4 },
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    setOffset((current) => constrainedOffset({ x: current.x + delta.x, y: current.y + delta.y }));
  }

  async function exportCrop() {
    const image = imageRef.current;
    if (!image || !imageSize.width || !imageSize.height) return;

    setIsExporting(true);
    setError('');
    try {
      const displayScale = baseScale * zoom;
      const sourceSize = Math.min(
        imageSize.width,
        imageSize.height,
        cropSize / displayScale
      );
      const sourceCenterX = imageSize.width / 2 - offset.x / displayScale;
      const sourceCenterY = imageSize.height / 2 - offset.y / displayScale;
      const sourceX = clamp(sourceCenterX - sourceSize / 2, 0, imageSize.width - sourceSize);
      const sourceY = clamp(sourceCenterY - sourceSize / 2, 0, imageSize.height - sourceSize);
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare the crop.');

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('Your browser could not save the crop.'))),
          'image/jpeg',
          0.92
        );
      });
      await onConfirm(new File([blob], outputFilename(file.name), { type: 'image/jpeg' }));
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Could not crop this photo.');
      setIsExporting(false);
    }
  }

  return (
    <div
      className="avatar-crop-backdrop"
      role="presentation"
      onPointerDown={() => {
        if (!isExporting) onCancel();
      }}
    >
      <section
        className="avatar-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-crop-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="avatar-crop-heading">
          <div>
            <p className="profile-eyebrow">Profile photo</p>
            <h2 id="avatar-crop-title">Crop your photo</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={isExporting} aria-label="Close crop dialog">
            ×
          </button>
        </div>

        <div
          ref={cropRef}
          className="avatar-crop-stage"
          role="application"
          aria-label="Drag the photo to reposition it. Use arrow keys for fine adjustments."
          tabIndex={0}
          onKeyDown={nudgeImage}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
        >
          {/* The local object URL is intentionally rendered without next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={previewUrl}
            alt="Avatar crop preview"
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
              setOffset({ x: 0, y: 0 });
            }}
            style={{
              width: imageSize.width ? imageSize.width * baseScale : 'auto',
              height: imageSize.height ? imageSize.height * baseScale : 'auto',
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            }}
          />
          <span className="avatar-crop-mask" aria-hidden="true" />
        </div>

        <p className="avatar-crop-hint">Drag to reposition · zoom to frame</p>
        <label className="avatar-crop-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step="0.01"
            value={zoom}
            disabled={!imageSize.width || isExporting}
            onChange={(event) => handleZoom(Number(event.currentTarget.value))}
          />
        </label>
        {error ? <p className="avatar-crop-error" role="alert">{error}</p> : null}

        <div className="avatar-crop-actions">
          <button type="button" className="avatar-crop-cancel" onClick={onCancel} disabled={isExporting}>
            Cancel
          </button>
          <button
            type="button"
            className="avatar-crop-confirm"
            onClick={exportCrop}
            disabled={!imageSize.width || isExporting}
          >
            {isExporting ? 'Preparing…' : 'Use photo'}
          </button>
        </div>
      </section>
    </div>
  );
}
