import type { FastifyInstance, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { LoginSchema } from '@railguard/shared';
import { prisma } from '../db';
import { env, isProd } from '../env';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/auth-plugin';
import { newRefreshToken, sha256 } from '../lib/security';

const COOKIE = 'rg_refresh';
const MAX_FAILS = 5;
const LOCK_MIN = 15;
// Used to burn the same CPU time when the email is unknown (avoids user enumeration by timing).
const DUMMY_HASH = await argon2.hash('not-a-real-password', { type: argon2.argon2id });

export async function authRoutes(app: FastifyInstance) {
  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax', // web (Vercel) and API are on different sites in production
      path: '/auth',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400,
    });

  async function issue(
    reply: FastifyReply,
    user: { id: string; role: never; divisionId: string | null },
    familyId: string = randomUUID(),
    ua?: string,
  ) {
    const raw = newRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        userAgent: ua?.slice(0, 200),
      },
    });
    setCookie(reply, raw);
    return app.jwt.sign(
      { sub: user.id, role: user.role, div: user.divisionId },
      { expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m` },
    );
  }

  const publicUser = (u: {
    id: string;
    email: string;
    name: string;
    role: string;
    divisionId: string | null;
    totpEnabled: boolean;
  }) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    divisionId: u.divisionId,
    totpEnabled: u.totpEnabled,
  });

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags: ['auth'], summary: 'Email + password (+ TOTP for 2FA users)' },
    },
    async (req, reply) => {
      const body = LoginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user || !user.isActive) {
        await argon2.verify(DUMMY_HASH, body.password).catch(() => false);
        throw new HttpError(401, 'Invalid email or password');
      }
      if (user.lockedUntil && user.lockedUntil > new Date())
        throw new HttpError(423, 'Account temporarily locked. Try again later.');

      const ok = await argon2.verify(user.passwordHash, body.password).catch(() => false);
      if (!ok) {
        const fails = user.failedLogins + 1;
        await prisma.user.update({
          where: { id: user.id },
          data:
            fails >= MAX_FAILS
              ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MIN * 60_000) }
              : { failedLogins: fails },
        });
        throw new HttpError(401, 'Invalid email or password');
      }
      if (user.totpEnabled) {
        if (!body.totpCode)
          return reply
            .code(401)
            .send({ error: 'TOTP_REQUIRED', message: 'Enter your 6-digit authentication code' });
        if (!authenticator.check(body.totpCode, user.totpSecret ?? ''))
          throw new HttpError(401, 'Invalid authentication code');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      const accessToken = await issue(reply, user as never, undefined, req.headers['user-agent']);
      req.user = { sub: user.id, role: user.role, div: user.divisionId };
      await audit(req, 'auth.login', 'user', user.id);
      return { accessToken, user: publicUser(user) };
    },
  );

  /** Refresh-token rotation: each token is single-use; replaying a used token revokes the whole family. */
  app.post(
    '/auth/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['auth'] } },
    async (req, reply) => {
      const raw = req.cookies[COOKIE];
      if (!raw) throw new HttpError(401, 'No session');
      const tok = await prisma.refreshToken.findUnique({
        where: { tokenHash: sha256(raw) },
        include: { user: true },
      });
      if (!tok) throw new HttpError(401, 'Invalid session');
      if (tok.rotatedAt || tok.revokedAt) {
        await prisma.refreshToken.updateMany({
          where: { familyId: tok.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        reply.clearCookie(COOKIE, { path: '/auth' });
        throw new HttpError(401, 'Session reuse detected. Please sign in again.');
      }
      if (tok.expiresAt < new Date() || !tok.user.isActive)
        throw new HttpError(401, 'Session expired');
      await prisma.refreshToken.update({ where: { id: tok.id }, data: { rotatedAt: new Date() } });
      const accessToken = await issue(
        reply,
        tok.user as never,
        tok.familyId,
        req.headers['user-agent'],
      );
      return { accessToken, user: publicUser(tok.user) };
    },
  );

  app.post('/auth/logout', { schema: { tags: ['auth'] } }, async (req, reply) => {
    const raw = req.cookies[COOKIE];
    if (raw) {
      const tok = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
      if (tok)
        await prisma.refreshToken.updateMany({
          where: { familyId: tok.familyId },
          data: { revokedAt: new Date() },
        });
    }
    reply.clearCookie(COOKIE, { path: '/auth' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.authenticate, schema: { tags: ['auth'] } }, async (req) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
    return publicUser(u);
  });

  // ----- optional TOTP 2FA (offered to admins) -----
  app.post(
    '/auth/totp/setup',
    { preHandler: app.authenticate, schema: { tags: ['auth'] } },
    async (req) => {
      if (req.user.role !== 'ADMIN') throw new HttpError(403, 'Only admins can enable 2FA');
      const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
      const secret = authenticator.generateSecret();
      await prisma.user.update({
        where: { id: u.id },
        data: { totpSecret: secret, totpEnabled: false },
      });
      return { secret, otpauthUrl: authenticator.keyuri(u.email, 'RAILGUARD AI', secret) };
    },
  );

  app.post(
    '/auth/totp/enable',
    { preHandler: app.authenticate, schema: { tags: ['auth'] } },
    async (req) => {
      const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
      const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } });
      if (!u.totpSecret || !authenticator.check(code, u.totpSecret))
        throw new HttpError(400, 'Invalid code');
      await prisma.user.update({ where: { id: u.id }, data: { totpEnabled: true } });
      await audit(req, 'auth.totp_enable', 'user', u.id);
      return { ok: true };
    },
  );
}
