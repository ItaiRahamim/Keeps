'use client';

function extensionFromType(type: string): string | null {
  const subtype = type.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  if (!subtype) return null;
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'quicktime') return 'mov';
  if (subtype === 'x-m4v') return 'm4v';
  return subtype.replace(/[^a-z0-9]/g, '') || null;
}

function extensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url, window.location.href).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function safeBaseName(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return normalized || 'memokeep';
}

export async function downloadMediaFile(
  url: string,
  suggestedName: string,
  signal?: AbortSignal
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(url, { mode: 'cors', signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(
      'Download could not reach the media file. Check the R2 CORS policy allows GET requests from this site.'
    );
  }

  if (!response.ok) {
    throw new Error(`Download failed: R2 returned ${response.status} ${response.statusText || 'Unknown error'}.`);
  }

  const blob = await response.blob();
  if (blob.size === 0) throw new Error('Download failed: R2 returned an empty file.');

  const extension = extensionFromType(blob.type) ?? extensionFromUrl(url);
  const baseName = safeBaseName(suggestedName);
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(baseName);
  const fileName = extension && !hasExtension ? `${baseName}.${extension}` : baseName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  try {
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}
