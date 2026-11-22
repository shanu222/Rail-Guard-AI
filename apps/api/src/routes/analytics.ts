import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { HttpError, requirePerm } from '../lib/auth-plugin';
import { analytics, monthSummary, pilotMetrics } from '../lib/metrics';
import { buildMonthlyPdf } from '../lib/pdf';
import { idParams, plain, scopeOf, Uuid } from '../lib/scope';
import { getObjectBuffer, makeKey, presignGet, putObject } from '../lib/storage';
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
      const div = scopeOf(req.user, b.divisionId) ?? b.divisionId;
      const division = await prisma.division.findUnique({ where: { id: div } });
      if (!division) throw new HttpError(404, 'Division not found');
      // Name the failing step so a problem is diagnosable from the UI message and the logs.
      const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn();
        } catch (err) {
          const msg = (err as Error).message ?? String(err);
          req.log.error(`report step failed (${name}): ${msg.slice(0, 300)}`);
          throw new HttpError(
            500,
            `Report failed while ${name}: ${msg.trim().split('\n').pop()?.slice(0, 200)}`,
          );
        }
      };
      const [summary, config, demoDevices, me] = await step('loading report data', () =>
        Promise.all([
          monthSummary(div, b.month),
          loadRiskConfig(),
          prisma.device.count({ where: { divisionId: div, isDemo: true } }),
          prisma.user.findUnique({
            where: { id: req.user.sub },
            select: { name: true, role: true },
          }),
        ]),
      );
      const pdf = await step('building the PDF', () =>
        buildMonthlyPdf({
          divisionName: division.name,
          month: b.month,
          summary,
          demo: demoDevices > 0,
          config,
          generatedBy: me ? `${me.name} (${me.role})` : undefined,
        }),
      );
      // Archive in private storage as a best effort: a storage problem must never stop the user
      // from getting the report they just asked for.
      let reportId: string | null = null;
      try {
        const key = makeKey('report', div, 'application/pdf');
        // never let a slow storage call hold the user's download hostage
        await Promise.race([
          putObject(key, pdf, 'application/pdf'),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('storage timeout (15 s)')), 15_000),
          ),
        ]);
        const rep = await prisma.report.create({
          data: { divisionId: div, month: b.month, r2Key: key, createdById: req.user.sub },
        });
        reportId = rep.id;
        await audit(req, 'report.generate', 'report', rep.id, null, { month: b.month }).catch(
          () => undefined,
        );
      } catch (err) {
        req.log.error(
          `report archive failed (PDF still returned): ${(err as Error).message?.slice(0, 300)}`,
        );
      }
      const safe = division.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'division';
      return reply
        .code(200)
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="RAILGUARD-${safe}-${b.month}.pdf"`)
        .header('x-report-archived', reportId ? 'true' : 'false')
        .header('access-control-expose-headers', 'content-disposition, x-report-archived')
        .send(pdf);
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

  /** Stored report streamed through the API (no popup, no bucket CORS needed). */
  app.get(
    '/v1/reports/:id/file',
    { preHandler: requirePerm(app, 'reports:read'), schema: { tags: ['reports'] } },
    async (req, reply) => {
      const { id } = idParams.parse(req.params);
      const rep = await prisma.report.findUnique({
        where: { id },
        include: { division: { select: { name: true } } },
      });
      if (!rep || (req.user.div && rep.divisionId !== req.user.div))
        throw new HttpError(404, 'Not found');
      let pdf: Buffer;
      try {
        pdf = await getObjectBuffer(rep.r2Key);
      } catch (err) {
        req.log.error(`stored report read failed: ${(err as Error).message?.slice(0, 300)}`);
        throw new HttpError(502, 'The stored report could not be read. Generate it again.');
      }
      const safe =
        rep.division.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'division';
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="RAILGUARD-${safe}-${rep.month}.pdf"`)
        .header('access-control-expose-headers', 'content-disposition')
        .send(pdf);
    },
  );
}
