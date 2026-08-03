import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@/lib/supabase/server';
import { PresignRequest, PresignResponse, getMediaUrl } from '@/lib/contracts';

const PRESIGN_EXPIRY_SECONDS = 5 * 60;

// Object-key extensions land directly in the R2/S3 key, so keep the
// character set tight (alphanumeric only) to rule out path traversal
// (`../`), accidental extra path segments (`/`), or absurdly long values —
// none of which a real file extension needs.
function sanitizeExt(ext: string): string | null {
  const cleaned = ext.replace(/^\.+/, '').toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(cleaned)) return null;
  return cleaned;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = PresignRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { contentType, ext, kind } = parsed.data;
  // `kind` is validated as part of the request shape ('original' | 'thumbnail')
  // but the key template below is fixed per spec — it does not branch on kind.
  void kind;

  const safeExt = sanitizeExt(ext);
  if (!safeExt) {
    return NextResponse.json({ error: 'invalid_ext' }, { status: 400 });
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    // Server misconfiguration (missing env vars) — not the caller's fault.
    return NextResponse.json({ error: 'storage_not_configured' }, { status: 500 });
  }

  // Server-generated key — never trust a client-supplied key/path.
  const key = `media/${user.id}/${randomUUID()}.${safeExt}`;

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  let putUrl: string;
  try {
    putUrl = await getSignedUrl(client, command, {
      expiresIn: PRESIGN_EXPIRY_SECONDS,
    });
  } catch {
    return NextResponse.json({ error: 'presign_failed' }, { status: 500 });
  }

  const response = PresignResponse.parse({
    putUrl,
    key,
    publicUrl: getMediaUrl(key),
  });

  return NextResponse.json(response);
}
