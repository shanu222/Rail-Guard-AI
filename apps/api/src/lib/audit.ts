import type { FastifyRequest } from 'fastify';
import { prisma } from '../db';

const REDACT = /password|secret|token|hash|totp|api_?key/i;

/** Strip secrets before anything is written to the audit log. */
function clean(v: unknown): unknown {
  if (v === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) =>
      REDACT.test(k) ? '[redacted]' : typeof val === 'bigint' ? Number(val) : val,
    ),
  );
}

export async function audit(
  req: FastifyRequest,
  action: string,
  entity: string,
  entityId?: string | null,
  before?: unknown,
  after?: unknown,
  deviceId?: string,
) {
  await prisma.auditLog.create({
    data: {
      userId: req.user?.sub ?? null,
      deviceId: deviceId ?? null,
      action,
      entity,
      entityId: entityId ?? null,
      before: clean(before) as never,
      after: clean(after) as never,
      ip: req.ip,
    },
  });
}
