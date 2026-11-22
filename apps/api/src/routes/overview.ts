import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '../db';
import { plain, scopeOf } from '../lib/scope';

export async function overviewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/v1/overview',
    { schema: { tags: ['overview'], summary: 'KPI cards, detections-by-class trend, alert feed' } },
    async (req) => {
      const q = z
        .object({
          divisionId: z.string().uuid().optional(),
          days: z.coerce.number().int().min(7).max(180).default(30),
        })
        .parse(req.query);
      const div = scopeOf(req.user, q.divisionId);
      const dClause = div ? Prisma.sql`dev.division_id = ${div}::uuid` : Prisma.sql`TRUE`;
      const since24 = new Date(Date.now() - 86_400_000);
      const sinceN = new Date(Date.now() - q.days * 86_400_000);
      const since90 = new Date(Date.now() - 90 * 86_400_000);

      const [km, severe, pending, crossings, warnings, avgRisk, trend, alerts] = await Promise.all([
        prisma.$queryRaw<
          { km: number }[]
        >`SELECT COALESCE(SUM(length_km),0)::float AS km FROM sections WHERE ${div ? Prisma.sql`division_id = ${div}::uuid` : Prisma.sql`TRUE`}`,
        prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM detections d JOIN devices dev ON dev.id = d.device_id
        WHERE ${dClause} AND d.severity = 'SEVERE' AND d.review_status <> 'REJECTED' AND d.detected_at >= ${since90}
          AND NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.status = 'DONE' AND d.id = ANY(w.detection_ids))`,
        prisma.$queryRaw<
          { n: number }[]
        >`SELECT COUNT(*)::int AS n FROM detections d JOIN devices dev ON dev.id = d.device_id WHERE ${dClause} AND d.review_status = 'PENDING'`,
        prisma.$queryRaw<{ online: number; total: number }[]>`
        SELECT COUNT(*) FILTER (WHERE status = 'ONLINE')::int AS online, COUNT(*)::int AS total
        FROM devices dev WHERE type = 'CROSSING' AND revoked_at IS NULL AND ${dClause}`,
        prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM crossing_events e JOIN devices dev ON dev.id = e.device_id
        WHERE ${dClause} AND e.warning_triggered AND e.occurred_at >= ${since24}`,
        prisma.$queryRaw<{ avg: number | null }[]>`
        SELECT AVG(l.score)::float AS avg FROM segment_latest_risk l JOIN segments s ON s.id = l.segment_id JOIN sections sec ON sec.id = s.section_id
        WHERE ${div ? Prisma.sql`sec.division_id = ${div}::uuid` : Prisma.sql`TRUE`}`,
        prisma.$queryRaw<{ day: string; defect_class: string; n: number }[]>`
        SELECT to_char(date_trunc('day', d.detected_at), 'YYYY-MM-DD') AS day, d.defect_class::text AS defect_class, COUNT(*)::int AS n
        FROM detections d JOIN devices dev ON dev.id = d.device_id
        WHERE ${dClause} AND d.detected_at >= ${sinceN} AND d.review_status <> 'REJECTED' GROUP BY 1, 2 ORDER BY 1`,
        prisma.notification.findMany({
          where: div ? { divisionId: div } : {},
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: { id: true, type: true, title: true, body: true, data: true, createdAt: true },
        }),
      ]);

      const byDay = new Map<string, Record<string, number | string>>();
      for (const r of trend) {
        const row = byDay.get(r.day) ?? { date: r.day };
        row[r.defect_class] = r.n;
        byDay.set(r.day, row);
      }
      return plain({
        kpis: {
          kmMonitored: km[0]?.km ?? 0,
          openSevereDefects: severe[0]?.n ?? 0,
          awaitingReview: pending[0]?.n ?? 0,
          crossingsOnline: crossings[0]?.online ?? 0,
          crossingsTotal: crossings[0]?.total ?? 0,
          warnings24h: warnings[0]?.n ?? 0,
          avgSegmentRisk: avgRisk[0]?.avg ?? null,
        },
        trend: [...byDay.values()],
        alerts,
      });
    },
  );

  app.get('/v1/notifications', { schema: { tags: ['overview'] } }, async (req) => {
    const div = scopeOf(req.user);
    return prisma.notification.findMany({
      where: div ? { divisionId: div } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });
}
