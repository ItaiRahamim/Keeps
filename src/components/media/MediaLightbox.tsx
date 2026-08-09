'use client';

import Image from 'next/image';
import { useEffect, useId, useRef } from 'react';
import { getMediaUrl } from '@/lib/contracts';
import type { MediaRow } from '@/lib/types';
import './media-lightbox.css';

function resolveMediaUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : getMediaUrl(value);
}

export type MediaLightboxProps = {
  media: MediaRow;
  onClose: () => void;
};

export default function MediaLightbox({ media, onClose }: MediaLightboxProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mediaUrl = resolveMediaUrl(media.original_url);
  const title = media.caption?.trim() || (media.media_type === 'video' ? 'Video memory' : 'Photo memory');

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="media-lightbox__topbar">
        <h2 id={titleId} className="media-lightbox__title">
          {title}
        </h2>
        <div className="media-lightbox__actions">
          <button
            ref={closeButtonRef}
            type="button"
            className="media-lightbox__close"
            onClick={onClose}
            aria-label="Close fullscreen media"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="media-lightbox__stage">
        {media.media_type === 'video' ? (
          <video
            className="media-lightbox__media"
            src={mediaUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={title}
          />
        ) : (
          <div className="media-lightbox__image">
            <Image
              src={mediaUrl}
              alt={title}
              fill
              unoptimized
              priority
              sizes="100vw"
              draggable={false}
            />
          </div>
        )}
      </div>

    </div>
  );
}
