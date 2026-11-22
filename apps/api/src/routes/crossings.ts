import type { FastifyInstance } from 'fastify';
import { prisma, Prisma } from '../db';
import { HttpError } from '../lib/auth-plugin';
import { idParams, plain, scopeOf } from '../lib/scope';
import { presignGet } from '../lib/storage';

export async function crossingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/v1/crossings', { schema: { tags: ['crossings'] } }, async (req) => {
    const div = scopeOf(req.user);
    const since = new Date(Date.now() - 86_400_000);
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT c.id, c.name, c.status::text AS status, ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat,
             d.id AS unit_id, d.name AS unit_name, d.status::text AS unit_status, d.battery_pct, d.last_seen_at,
             (SELECT COUNT(*)::int FROM crossing_events e WHERE e.crossing_id = c.id AND e.occurred_at >= ${since}) AS events_24h,
             (SELECT COUNT(*)::int FROM crossing_events e WHERE e.crossing_id = c.id AND e.warning_triggered AND e.occurred_at >= ${since}) AS warnings_24h,
             (SELECT MAX(e.occurred_at) FROM crossing_events e WHERE e.crossing_id = c.id) AS last_event_at
      FROM crossings c LEFT JOIN devices d ON d.id = c.unit_id
      WHERE ${div ? Prisma.sql`c.division_id = ${div}::uuid` : Prisma.sql`TRUE`} ORDER BY c.name`;
    return plain(rows);
  });

  app.get('/v1/crossings/:id', { schema: { tags: ['crossings'] } }, async (req) => {
    const { id } = idParams.parse(req.params);
    const c = await prisma.crossing.findUnique({
      where: { id },
      include: {
        unit: {
          select: {
            id: true,
            name: true,
            status: true,
            batteryPct: true,
            solarW: true,
            lastSeenAt: true,
          },
        },
      },
    });
    if (!c || (req.user.div && c.divisionId !== req.user.div))
      throw new HttpError(404, 'Not found');
    const since = new Date(Date.now() - 30 * 86_400_000);

    const [geom, events, classes, daily, heat, totals] = await Promise.all([
      prisma.$queryRaw<
        { lon: number; lat: number }[]
      >`SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM crossings WHERE id = ${id}::uuid`,
      prisma.crossingEvent.findMany({
        where: { crossingId: id },
        orderBy: { occurredAt: 'desc' },
        take: 40,
        select: {
          id: true,
          occurredAt: true,
          objectClass: true,
          trainApproaching: true,
          dwellSeconds: true,
          warningTriggered: true,
          confidence: true,
          snapshotKey: true,
        },
      }),
      prisma.$queryRaw<
        { object_class: string; n: number }[]
      >`SELECT object_class::text AS object_class, COUNT(*)::int AS n FROM crossing_events WHERE crossing_id = ${id}::uuid AND occurred_at >= ${since} GROUP BY 1 ORDER BY 2 DESC`,
      prisma.$queryRaw<{ day: string; events: number; warnings: number }[]>`
        SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS events, COUNT(*) FILTER (WHERE warning_triggered)::int AS warnings
        FROM crossing_events WHERE crossing_id = ${id}::uuid AND occurred_at >= ${since} GROUP BY 1 ORDER BY 1`,
      // busiest hours heat-map: day-of-week (0=Sun) x hour (UTC; the UI shifts to PKT)
      prisma.$queryRaw<{ dow: number; hour: number; n: number }[]>`
        SELECT EXTRACT(DOW FROM occurred_at)::int AS dow, EXTRACT(HOUR FROM occurred_at)::int AS hour, COUNT(*)::int AS n
        FROM crossing_events WHERE crossing_id = ${id}::uuid AND occurred_at >= ${since} GROUP BY 1, 2`,
      prisma.$queryRaw<{ events: number; warnings: number; train_events: number }[]>`
        SELECT COUNT(*)::int AS events, COUNT(*) FILTER (WHERE warning_triggered)::int AS warnings, COUNT(*) FILTER (WHERE train_approaching)::int AS train_events
        FROM crossing_events WHERE crossing_id = ${id}::uuid AND occurred_at >= ${since}`,
    ]);
    const latestSnap = events.find((e) => e.snapshotKey);
    return plain({
      id: c.id,
      name: c.name,
      status: c.status,
      lon: geom[0]?.lon,
      lat: geom[0]?.lat,
      unit: c.unit,
      dangerZone: c.dangerZone,
      totals30d: totals[0],
      classBreakdown: classes,
      daily,
      heatmap: heat,
      events: events.map(({ snapshotKey, ...e }) => ({ ...e, hasSnapshot: !!snapshotKey })),
      latestSnapshotUrl: latestSnap?.snapshotKey
        ? await presignGet(latestSnap.snapshotKey, 300)
        : null,
      privacyNote:
        'Privacy protected: faces and number plates are blurred on the device before upload.',
    });
  });
}
