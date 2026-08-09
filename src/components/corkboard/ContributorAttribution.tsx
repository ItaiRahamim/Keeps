import type { MediaRow } from '@/lib/types';
import './contributor-attribution.css';

export type ContributorSummary = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

function displayNameFor(media: MediaRow): string {
  return media.uploader?.display_name?.normalize('NFKC').trim() || 'someone';
}

function initialsFor(displayName: string): string {
  if (displayName === 'someone') return '♡';
  const words = displayName.split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last = Array.from(words[words.length - 1] ?? '')[0] ?? '';
  return `${first}${words.length > 1 ? last : ''}`.toLowerCase();
}

export function contributorFor(media: MediaRow): ContributorSummary {
  return {
    id: media.uploader?.id ?? media.user_id,
    displayName: displayNameFor(media),
    avatarUrl: media.uploader?.avatar_url?.trim() || null,
  };
}

export function distinctContributors(mediaItems: readonly MediaRow[]): ContributorSummary[] {
  const contributors = new Map<string, ContributorSummary>();
  mediaItems.forEach((media) => {
    const contributor = contributorFor(media);
    if (!contributors.has(contributor.id)) contributors.set(contributor.id, contributor);
  });
  return [...contributors.values()];
}

function ContributorAvatar({ contributor }: { contributor: ContributorSummary }) {
  return (
    <span className="contributor-avatar" aria-hidden="true">
      <span>{initialsFor(contributor.displayName)}</span>
      {contributor.avatarUrl ? (
        // Profile avatars may come from the user's identity provider, not
        // the app's configured R2 image host, so this intentionally stays a
        // tiny native image instead of expanding Next's remote allow-list.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={contributor.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </span>
  );
}

export function PhotoContributor({ media }: { media: MediaRow }) {
  const contributor = contributorFor(media);
  return (
    <span
      className="photo-contributor"
      aria-label={`kept by ${contributor.displayName}`}
      title={`kept by ${contributor.displayName}`}
    >
      <ContributorAvatar contributor={contributor} />
      <span className="photo-contributor-name" dir="auto">{contributor.displayName}</span>
    </span>
  );
}

export function AlbumContributors({ mediaItems }: { mediaItems: readonly MediaRow[] }) {
  const contributors = distinctContributors(mediaItems);
  const visible = contributors.slice(0, 4);
  const overflow = contributors.length - visible.length;
  const names = contributors.map((contributor) => contributor.displayName).join(', ');
  const summary =
    contributors.length === 1
      ? contributors[0].displayName
      : `${contributors.length} keepers`;

  return (
    <span className="album-contributors" aria-label={`kept by ${names}`} title={`kept by ${names}`}>
      <span className="album-contributor-avatars" aria-hidden="true">
        {visible.map((contributor) => (
          <ContributorAvatar key={contributor.id} contributor={contributor} />
        ))}
        {overflow > 0 ? <span className="album-contributor-more">+{overflow}</span> : null}
      </span>
      <span className="album-contributor-summary" dir="auto">kept by {summary}</span>
    </span>
  );
}
