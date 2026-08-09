import { z } from 'zod';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const AvatarPresignRequest = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive().max(MAX_AVATAR_BYTES),
});

export const AvatarPresignResponse = z.object({
  putUrl: z.url(),
  publicUrl: z.url(),
});

export type AvatarPresignResponseT = z.infer<typeof AvatarPresignResponse>;

