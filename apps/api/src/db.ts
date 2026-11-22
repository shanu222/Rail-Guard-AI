import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();
export { Prisma };

/** Join a list of SQL fragments with AND (empty => TRUE). */
export function andAll(parts: Prisma.Sql[]): Prisma.Sql {
  return parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
}
