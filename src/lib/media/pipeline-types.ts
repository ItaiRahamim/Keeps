// Shared client-side media pipeline types. Consumed by the UI/UX agent's
// upload flow — do not change these shapes without coordinating (see
// AGENTS.md / the infra agent's task spec).

export type ProcessedThumbnail = {
  blob: Blob; // WebP (JPEG fallback if canvas.toBlob('image/webp') unsupported), ~800px longest edge
  lqip: string; // tiny base64 data: URI, ~20px longest edge, for blur-up placeholder
  width: number;
  height: number;
};

export type ProcessedUpload = {
  mediaType: 'image' | 'video';
  fileBlob: Blob; // raw or HEIC-transcoded original, ready to PUT to R2
  ext: string; // e.g. 'webp' | 'jpg' | 'mp4' | 'mov'
  contentType: string; // MIME type, used both for the presign request and the R2 PUT Content-Type header
  thumbnail: ProcessedThumbnail;
  lat_lng: { x: number; y: number } | null; // EXIF GPS — images only, null for video
  width: number | null;
  height: number | null;
  duration_ms: number | null; // videos only, null for images
};
