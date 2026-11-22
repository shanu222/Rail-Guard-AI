import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { HttpError, requirePerm } from '../lib/auth-plugin';
import { analytics, monthSummary, pilotMetrics } from '../lib/metrics';
import { buildMonthlyPdf } from '../lib/pdf';
import { idParams, plain, scopeOf, Uuid } from '../lib/scope';
import { makeKey, presignGet, putObject } from '../lib/storage';
import { env } from '../env';
import { loadRiskConfig } from '../risk/run';

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/v1/analytics', { schema: { tags: ['analytics'] } }, async (req) => {
    const q = z
      .object({
        divisionId: Uuid.optional(),
        months: z.coerce.number().int().min(1).max(24).default(6),
      })
      .parse(req.query);
    return plain(await analytics(scopeOf(req.user, q.divisionId), q.months));
  });

  app.get(
    '/v1/pilot',
    { schema: { tags: ['analytics'], summary: 'Pilot success metrics vs targets' } },
    async (req) => {
      const q = z.object({ divisionId: Uuid.optional() }).parse(req.query);
      return plain(await pilotMetrics(scopeOf(req.user, q.divisionId)));
    },
  );

  // ---- monthly PDF reports (generated server-side, stored privately in R2) ----
  app.get(
    '/v1/reports',
    { preHandler: requirePerm(app, 'reports:read'), schema: { tags: ['reports'] } },
    async (req) => {
      const div = scopeOf(req.user);
      return prisma.report.findMany({
        where: div ? { divisionId: div } : {},
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { division: { select: { name: true } } },
      });
    },
  );

  app.post(
    '/v1/reports/monthly',
    { preHandler: requirePerm(app, 'reports:read'), schema: { tags: ['reports'] } },
    async (req, reply) => {
      const b = z
        .object({ divisionId: Uuid, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
        .parse(req.body);
      const div = scopeOf(req.user, b.divisionId)!;
      const division = await prisma.division.findUnique({ where: { id: div } });
      if (!division) throw new HttpError(404, 'Division not found');
      const [summary, config, demoDevices] = await Promise.all([
        monthSummary(div, b.month),
        loadRiskConfig(),
        prisma.device.count({ where: { divisionId: div, isDemo: true } }),
      ]);
      const pdf = await buildMonthlyPdf({
        divisionName: division.name,
        month: b.month,
        summary,
        demo: env.DEMO_MODE || demoDevices > 0,
        config,
      });
      const key = makeKey('report', div, 'application/pdf');
      await putObject(key, pdf, 'application/pdf');
      const rep = await prisma.report.create({
        data: { divisionId: div, month: b.month, r2Key: key, createdById: req.user.sub },
      });
      await audit(req, 'report.generate', 'report', rep.id, null, { month: b.month });
      return reply.code(201).send({ id: rep.id, month: b.month, url: await presignGet(key, 300) });
    },
  );

  app.get(
    '/v1/reports/:id/url',
    { preHandler: requirePerm(app, 'reports:read'), schema: { tags: ['reports'] } },
    async (req) => {
      const { id } = idParams.parse(req.params);
      const rep = await prisma.report.findUnique({ where: { id } });
      if (!rep || (req.user.div && rep.divisionId !== req.user.div))
        throw new HttpError(404, 'Not found');
      return { url: await presignGet(rep.r2Key, 300) };
    },
  );
}
