/**
 * Create (or reset the password of) an Admin user. Use this in production instead of the demo seed.
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD='long-Password-123' pnpm --filter @railguard/api create-admin
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { CreateUserSchema } from '@railguard/shared';

const parsed = CreateUserSchema.safeParse({
  email: process.env.ADMIN_EMAIL,
  name: process.env.ADMIN_NAME ?? 'Administrator',
  role: 'ADMIN',
  divisionId: null,
  password: process.env.ADMIN_PASSWORD,
});
if (!parsed.success) {
  console.error(
    'Invalid input:',
    parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  );
  process.exit(1);
}
const { email, name, password } = parsed.data;
const prisma = new PrismaClient();
try {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, isActive: true, role: 'ADMIN', failedLogins: 0, lockedUntil: null },
    create: { email, name, role: 'ADMIN', passwordHash },
  });
  console.log(`Admin ready: ${email}`);
} finally {
  await prisma.$disconnect();
}
