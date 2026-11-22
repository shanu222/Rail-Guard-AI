import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../env';

/** Cloudflare R2 in production (endpoint derived from account id), MinIO locally (R2_ENDPOINT). */
const s3 = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: !!env.R2_ENDPOINT,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
});

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
};

export type MediaKind = 'image' | 'audio' | 'snapshot' | 'evidence' | 'report' | 'model';

/** Object keys embed the owner so access can be checked from the key alone: kind/ownerId/yyyy-mm/uuid.ext */
export function makeKey(kind: MediaKind, ownerId: string, contentType: string): string {
  const ym = new Date().toISOString().slice(0, 7);
  return `${kind}/${ownerId}/${ym}/${randomUUID()}.${EXT[contentType] ?? 'bin'}`;
}

export const keyOwner = (key: string) => key.split('/')[1];

export async function presignPut(key: string, contentType: string, expiresIn = 300) {
  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn },
  );
  return { url, expiresInSeconds: expiresIn };
}

/** Short-lived GET URL; buckets are never public. */
export async function presignGet(key: string, expiresIn = 300) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { expiresIn });
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

/** Write, read and delete a tiny object; returns the exact error so storage set-up can be fixed. */
export async function storageCheck() {
  const endpoint = env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const info = {
    bucket: env.R2_BUCKET,
    endpointHost: new URL(endpoint).host.replace(/^[0-9a-f]{8}/, (m) => `${m.slice(0, 4)}****`),
    accessKeyIdLength: env.R2_ACCESS_KEY_ID.length,
    secretLength: env.R2_SECRET_ACCESS_KEY.length,
    hasWhitespace: /\s|"|'/.test(
      env.R2_ACCOUNT_ID + env.R2_ACCESS_KEY_ID + env.R2_SECRET_ACCESS_KEY + env.R2_BUCKET,
    ),
  };
  const key = `healthcheck/${randomUUID()}.txt`;
  try {
    await putObject(key, Buffer.from('ok'), 'text/plain');
    await getObjectBuffer(key);
    await deleteObject(key);
    return { ok: true, ...info };
  } catch (err) {
    const e = err as Error & { Code?: string; $metadata?: { httpStatusCode?: number } };
    return {
      ok: false,
      ...info,
      error: `${e.name ?? 'Error'}: ${e.message?.slice(0, 300)}`,
      status: e.$metadata?.httpStatusCode ?? null,
    };
  }
}

/** Read a private object into memory (used to stream stored reports through the API). */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  const bytes = await r.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}
