'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MediaLightbox from '@/components/media/MediaLightbox';
import MediaOwnerMenu from '@/components/polaroid/MediaOwnerMenu';
import Logo from '@/components/brand/Logo';
import Pushpin from '@/components/pushpin/Pushpin';
import AvatarCropDialog from '@/components/profile/AvatarCropDialog';
import { signOut } from '@/lib/supabase/actions';
import {
  updateProfileAvatar,
  updateProfileName,
  type ProfileNameActionState,
} from '@/lib/profile/actions';
import {
  AvatarPresignRequest,
  AvatarPresignResponse,
  MAX_AVATAR_BYTES,
  type AvatarPresignResponseT,
} from '@/lib/profile/contracts';
import type { MediaRow, UserProfile } from '@/lib/types';

export type PersonalMemorySummary = {
  albumId: string;
  media: MediaRow;
  imageUrl: string | null;
  timestamp: string;
};

export type ParticipatedAlbumSummary = {
  id: string;
  title: string;
  totalCount: number;
  contributedCount: number;
  previewUrls: string[];
};

type ProfileDashboardProps = {
  profile: UserProfile;
  email: string;
  personalMemories: PersonalMemorySummary[];
  participatedAlbums: ParticipatedAlbumSummary[];
};

type AvatarStatus =
  | { kind: 'idle'; message: '' }
  | { kind: 'uploading'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

type AvatarCropSelection = {
  file: File;
  previewUrl: string;
};

const initialNameState: ProfileNameActionState = { status: 'idle', message: '' };
const MAX_AVATAR_SOURCE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

function formattedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function albumHref(albumId: string, mediaId?: string): string {
  const path = `/album/${encodeURIComponent(albumId)}`;
  return mediaId ? `${path}?media=${encodeURIComponent(mediaId)}` : path;
}

function memoryTitle(media: MediaRow): string {
  return media.caption?.trim() || media.memory_tag?.trim() || 'Untitled memory';
}

function putAvatar(
  upload: AvatarPresignResponseT,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload.putUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error('The avatar upload lost its connection.'));
    xhr.onabort = () => reject(new Error('The avatar upload was cancelled.'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`The avatar upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.send(file);
  });
}

export default function ProfileDashboard({
  profile,
  email,
  personalMemories,
  participatedAlbums,
}: ProfileDashboardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>({ kind: 'idle', message: '' });
  const [uploadProgress, setUploadProgress] = useState(0);
  const [avatarCrop, setAvatarCrop] = useState<AvatarCropSelection | null>(null);
  const [memoryPatches, setMemoryPatches] = useState<
    Record<string, { caption: string; memoryTag: string | null }>
  >({});
  const [deletedMemoryIds, setDeletedMemoryIds] = useState<Set<string>>(() => new Set());
  const [lightboxMedia, setLightboxMedia] = useState<MediaRow | null>(null);
  const [nameState, nameAction, namePending] = useActionState(updateProfileName, initialNameState);
  const displayName = nameState.status === 'success' ? nameState.displayName : profile.display_name;
  const isAvatarUploading = avatarStatus.kind === 'uploading';

  useEffect(() => {
    if (!avatarCrop) return;
    const previewUrl = avatarCrop.previewUrl;
    return () => URL.revokeObjectURL(previewUrl);
  }, [avatarCrop]);

  const memories = personalMemories
    .filter((memory) => !deletedMemoryIds.has(memory.media.id))
    .map((memory) => {
      const patch = memoryPatches[memory.media.id];
      return patch
        ? {
            ...memory,
            media: {
              ...memory.media,
              caption: patch.caption,
              memory_tag: patch.memoryTag,
            },
          }
        : memory;
    });

  function handleAvatarSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    if (
      !SUPPORTED_AVATAR_TYPES.has(file.type) ||
      file.size <= 0 ||
      file.size > MAX_AVATAR_SOURCE_BYTES
    ) {
      setAvatarStatus({
        kind: 'error',
        message: `Choose a JPG, PNG, or WebP image smaller than ${MAX_AVATAR_SOURCE_BYTES / 1024 / 1024} MB.`,
      });
      input.value = '';
      return;
    }

    setAvatarStatus({ kind: 'idle', message: '' });
    setAvatarCrop({ file, previewUrl: URL.createObjectURL(file) });
    input.value = '';
  }

  async function uploadCroppedAvatar(file: File) {
    const request = AvatarPresignRequest.safeParse({ contentType: file.type, size: file.size });
    if (!request.success) {
      setAvatarStatus({
        kind: 'error',
        message: `The cropped photo must be smaller than ${MAX_AVATAR_BYTES / 1024 / 1024} MB.`,
      });
      return;
    }

    setUploadProgress(0);
    setAvatarStatus({ kind: 'uploading', message: 'Preparing your new profile photo…' });
    try {
      const response = await fetch('/api/profile/avatar/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.data),
      });
      const responseBody: unknown = await response.json().catch(() => null);
      const upload = AvatarPresignResponse.safeParse(responseBody);
      if (!response.ok || !upload.success) {
        throw new Error('We could not prepare your profile photo upload.');
      }

      setAvatarStatus({ kind: 'uploading', message: 'Uploading your profile photo…' });
      await putAvatar(upload.data, file, setUploadProgress);
      const saved = await updateProfileAvatar(upload.data.publicUrl);
      if (!saved.ok) throw new Error(saved.message);

      setAvatarUrl(saved.avatarUrl);
      setAvatarStatus({ kind: 'success', message: 'Profile photo updated.' });
      router.refresh();
    } catch (error) {
      setAvatarStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'We could not update your profile photo.',
      });
    }
  }

  function handleMemoryDetailsChanged(
    id: string,
    patch: { caption: string; memoryTag: string | null }
  ) {
    setMemoryPatches((current) => ({ ...current, [id]: patch }));
    setLightboxMedia((current) =>
      current?.id === id
        ? { ...current, caption: patch.caption, memory_tag: patch.memoryTag }
        : current
    );
    router.refresh();
  }

  function handleMemoryDeleted(id: string) {
    setDeletedMemoryIds((current) => new Set(current).add(id));
    setLightboxMedia((current) => (current?.id === id ? null : current));
    router.refresh();
  }

  return (
    <main className="profile-page cork-texture" id="profile-main">
      <a className="profile-skip-link" href="#profile-content">
        Skip to profile content
      </a>

      <div className="profile-shell" id="profile-content">
        <nav className="profile-topbar" aria-label="Profile navigation">
          <Link href="/" className="profile-back-link">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to corkboard
          </Link>
          <Logo className="profile-wordmark" priority />
          <form action={signOut}>
            <button type="submit" className="profile-logout">
              Log out
            </button>
          </form>
        </nav>

        <section className="profile-identity-card" aria-labelledby="profile-heading">
          <Pushpin color="teal" position="top" />
          <div className="profile-avatar-column">
            <div className="profile-avatar" aria-live="polite">
              {avatarUrl ? (
                // Profile rows may begin with an OAuth provider URL. Unlike
                // board media, those hosts are intentionally not allowlisted
                // in next/image, so a native image is the safe dynamic-host
                // renderer here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={`${displayName}'s profile photo`}
                />
              ) : (
                <span aria-label={`${displayName}'s initials`}>{initialsFor(displayName) || 'M'}</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              id="profile-avatar-input"
              className="profile-visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={isAvatarUploading || avatarCrop !== null}
              onChange={handleAvatarSelection}
            />
            <button
              type="button"
              className="profile-avatar-button"
              disabled={isAvatarUploading || avatarCrop !== null}
              onClick={() => fileInputRef.current?.click()}
            >
              {isAvatarUploading ? `Uploading ${uploadProgress}%` : avatarUrl ? 'Change photo' : 'Add photo'}
            </button>
            <p
              className="profile-avatar-status"
              data-kind={avatarStatus.kind}
              aria-live="polite"
              aria-atomic="true"
            >
              {avatarStatus.message}
            </p>
          </div>

          <div className="profile-identity-copy">
            <p className="profile-eyebrow">Your keeper profile</p>
            <h1 id="profile-heading" dir="auto">{displayName}</h1>
            <p className="profile-email">{email}</p>

            <form action={nameAction} className="profile-name-form">
              <label htmlFor="profile-display-name">Display name</label>
              <div className="profile-name-row">
                <input
                  id="profile-display-name"
                  name="displayName"
                  defaultValue={profile.display_name}
                  maxLength={80}
                  autoComplete="name"
                  required
                  disabled={namePending}
                  aria-invalid={nameState.status === 'error'}
                  aria-describedby="profile-name-message"
                />
                <button type="submit" disabled={namePending}>
                  {namePending ? 'Saving…' : 'Save name'}
                </button>
              </div>
              <p
                id="profile-name-message"
                className="profile-form-message"
                data-status={nameState.status}
                aria-live="polite"
              >
                {nameState.message}
              </p>
            </form>
          </div>

          <dl className="profile-stats" aria-label="Your memory statistics">
            <div>
              <dt>Memories</dt>
              <dd>{memories.length}</dd>
            </div>
            <div>
              <dt>Albums joined</dt>
              <dd>{participatedAlbums.length}</dd>
            </div>
          </dl>
        </section>

        <section className="profile-section profile-memories-section" aria-labelledby="personal-memories-heading">
          <div className="profile-section-heading">
            <div>
              <p className="profile-eyebrow">Pinned by you</p>
              <h2 id="personal-memories-heading">Personal memories</h2>
            </div>
            <span>{memories.length}</span>
          </div>

          {memories.length > 0 ? (
            <div className="profile-memory-grid">
              {memories.map((memory, index) => {
                const title = memoryTitle(memory.media);
                const albumName = memory.media.memory_tag?.trim() || null;
                return (
                  <div className="profile-memory-card-shell" key={memory.media.id}>
                    <Link
                      className="profile-memory-card"
                      href={albumHref(memory.albumId, memory.media.id)}
                      style={{ '--profile-tilt': `${((index % 5) - 2) * 0.55}deg` } as React.CSSProperties}
                    >
                      <div className="profile-memory-image">
                        {memory.imageUrl ? (
                          <Image src={memory.imageUrl} alt="" fill sizes="(max-width: 640px) 45vw, 210px" />
                        ) : (
                          <span>{memory.media.media_type === 'video' ? 'Video' : 'Photo'}</span>
                        )}
                        {memory.media.media_type === 'video' ? (
                          <span className="profile-video-badge" aria-label="Video memory">
                            ▶
                          </span>
                        ) : null}
                      </div>
                      <div className="profile-memory-caption">
                        <h3 dir="auto">{title}</h3>
                        <p>{albumName ? `${albumName} · ` : ''}{formattedDate(memory.timestamp)}</p>
                      </div>
                    </Link>
                    <MediaOwnerMenu
                      media={memory.media}
                      canManage
                      onDetailsChanged={handleMemoryDetailsChanged}
                      onDeleted={handleMemoryDeleted}
                      onViewFullscreen={setLightboxMedia}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="profile-empty-note">
              <strong>Your first memory is waiting.</strong>
              <p>Pin a photo or video to the corkboard and it will appear here.</p>
              <Link href="/">Add a memory</Link>
            </div>
          )}
        </section>

        <section className="profile-section profile-albums-section" aria-labelledby="participated-albums-heading">
          <div className="profile-section-heading">
            <div>
              <p className="profile-eyebrow">Made together</p>
              <h2 id="participated-albums-heading">Participated albums</h2>
            </div>
            <span>{participatedAlbums.length}</span>
          </div>

          {participatedAlbums.length > 0 ? (
            <div className="profile-album-grid">
              {participatedAlbums.map((album) => (
                <Link
                  className="profile-album-card"
                  key={album.id}
                  href={albumHref(album.id)}
                >
                  <div className="profile-album-tab" aria-hidden="true" />
                  <div className="profile-album-preview" aria-hidden="true">
                    {album.previewUrls.map((url, index) => (
                      <span key={url} style={{ '--album-preview-index': index } as React.CSSProperties}>
                        <Image src={url} alt="" fill sizes="120px" />
                      </span>
                    ))}
                  </div>
                  <div className="profile-album-copy">
                    <h3 dir="auto">{album.title}</h3>
                    <p>
                      You added {album.contributedCount} of {album.totalCount}{' '}
                      {album.totalCount === 1 ? 'memory' : 'memories'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="profile-empty-note profile-empty-note-album">
              <strong>No shared albums yet.</strong>
              <p>Add a memory or ticket name while uploading to start one with your people.</p>
              <Link href="/">Visit the corkboard</Link>
            </div>
          )}
        </section>
      </div>

      {avatarCrop ? (
        <AvatarCropDialog
          file={avatarCrop.file}
          previewUrl={avatarCrop.previewUrl}
          onCancel={() => setAvatarCrop(null)}
          onConfirm={async (croppedFile) => {
            setAvatarCrop(null);
            await uploadCroppedAvatar(croppedFile);
          }}
        />
      ) : null}

      {lightboxMedia ? (
        <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />
      ) : null}
    </main>
  );
}
