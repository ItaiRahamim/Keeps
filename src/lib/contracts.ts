import { z } from 'zod';

export const PresignRequest = z.object({
  contentType: z.string(),
  ext: z.string(),
  kind: z.enum(['original', 'thumbnail']),
});
export type PresignRequestT = z.infer<typeof PresignRequest>;

export const PresignResponse = z.object({
  putUrl: z.string(),
  key: z.string(),
  publicUrl: z.string(),
});
export type PresignResponseT = z.infer<typeof PresignResponse>;

// Joins the public R2 base URL with an object key, tolerating a trailing
// slash on the base URL and/or a leading slash on the key so the result
// never ends up with a double slash (or a missing one) regardless of how
// NEXT_PUBLIC_R2_PUBLIC_BASE_URL is set in the environment.
export function getMediaUrl(key: string): string {
  const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  const normalizedKey = key.replace(/^\/+/, '');
  return `${base}/${normalizedKey}`;
}
