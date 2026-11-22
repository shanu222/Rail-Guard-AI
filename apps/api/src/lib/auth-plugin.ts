import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { can, type Permission, type Role } from '@railguard/shared';

export interface JwtUser {
  sub: string;
  role: Role;
  div: string | null; // division scope; null => all divisions (Admin)
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    device?: { id: string; divisionId: string; type: 'TRACK' | 'CROSSING'; isDemo: boolean };
  }
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function authPlugin(app: FastifyInstance) {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Unauthorized');
    }
  });
}

/** preHandler factory: authenticated + role must hold the permission. */
export const requirePerm = (app: FastifyInstance, p: Permission) => [
  app.authenticate,
  async (req: FastifyRequest) => {
    if (!can(req.user.role, p)) throw new HttpError(403, 'Forbidden');
  },
];

/**
 * Division scoping. Non-admin users are locked to their own division regardless of what the
 * client asks for; admins may pass any division (or none => all).
 */
export function divisionScope(user: JwtUser, requested?: string | null): string | null {
  if (user.div) {
    if (requested && requested !== user.div) throw new HttpError(403, 'Outside your division');
    return user.div;
  }
  return requested ?? null;
}
