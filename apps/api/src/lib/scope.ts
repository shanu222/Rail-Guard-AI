import { z } from 'zod';
import { prisma, Prisma } from '../db';
import { HttpError, divisionScope, type JwtUser } from './auth-plugin';

/** Division the request is limited to (null = admin viewing all). */
export const scopeOf = (user: JwtUser, requested?: string | null) => divisionScope(user, requested);

/** Inspectors only see sections they are assigned to (if they have any assignments). */
export async function inspectorSectionIds(user: JwtUser): Promise<string[] | null> {
  if (user.role !== 'INSPECTOR') return null;
  const rows = await prisma.userSection.findMany({
    where: { userId: user.sub },
    select: { sectionId: true },
  });
  return rows.length ? rows.map((r) => r.sectionId) : null;
}

/** Throws 404 unless the segment exists and belongs to a division the user may see. */
export async function assertSegment(user: JwtUser, segmentId: string) {
  const rows = await prisma.$queryRaw<{ division_id: string }[]>`
    SELECT sec.division_id FROM segments s JOIN sections sec ON sec.id = s.section_id WHERE s.id = ${segmentId}::uuid`;
  if (!rows[0] || (user.div && rows[0].division_id !== user.div))
    throw new HttpError(404, 'Not found');
  return rows[0].division_id;
}

export const Uuid = z.string().uuid();
export const idParams = z.object({ id: Uuid });

/** Opaque cursor: base64url(JSON). */
export const encodeCursor = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function decodeCursor<T>(c: string | undefined): T | null {
  if (!c) return null;
  try {
    return JSON.parse(Buffer.from(c, 'base64url').toString()) as T;
  } catch {
    throw new HttpError(400, 'Bad cursor');
  }
}

export const sqlList = (ids: string[], cast = 'uuid') =>
  Prisma.sql`ANY(${ids}::${Prisma.raw(cast)}[])`;

/** BigInt-safe JSON (COUNT(*) etc. come back as bigint from raw queries). */
export function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));
}
