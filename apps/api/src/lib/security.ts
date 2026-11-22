import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Device key format: rgk_<8 hex prefix>_<48 hex secret>. Only sha256(secret) is stored. */
export function generateDeviceKey() {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('hex');
  return { prefix, plaintext: `rgk_${prefix}_${secret}`, hash: sha256(secret) };
}

export function parseDeviceKey(raw: string | undefined): { prefix: string; secret: string } | null {
  const m = /^rgk_([0-9a-f]{8})_([0-9a-f]{48})$/.exec(raw ?? '');
  return m ? { prefix: m[1]!, secret: m[2]! } : null;
}

export const newRefreshToken = () => randomBytes(48).toString('base64url');
