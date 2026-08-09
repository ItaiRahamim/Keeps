import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { getMediaUrl } from '@/lib/contracts';
import { AvatarPresignRequest, AvatarPresignResponse } from '@/lib/profile/contracts';
import { createClient } from '@/lib/supabase/server';

const PRESIGN_EXPIRY_SECONDS = 5 * 60;

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

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

  const parsed = AvatarPresignRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_avatar', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return NextResponse.json({ error: 'storage_not_configured' }, { status: 500 });
  }

  const { contentType, size } = parsed.data;
  const key = `avatars/${user.id}/${randomUUID()}.${MIME_EXTENSIONS[contentType]}`;
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const putUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      { expiresIn: PRESIGN_EXPIRY_SECONDS }
    );

    return NextResponse.json(
      AvatarPresignResponse.parse({
        putUrl,
        publicUrl: getMediaUrl(key),
      })
    );
  } catch (error) {
    console.error('Failed to presign profile avatar upload', error);
    return NextResponse.json({ error: 'presign_failed' }, { status: 500 });
  }
}

