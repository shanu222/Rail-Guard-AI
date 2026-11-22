import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RISK_DISCLAIMER } from '@railguard/shared';
import { prisma, Prisma, andAll } from '../db';
import { assertSegment, idParams, plain, scopeOf } from '../lib/scope';

const Q = z.object({
  divisionId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
});

export async function mapRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/v1/sections', { schema: { tags: ['map'] } }, async (req) => {
    const q = Q.parse(req.query);
    const div = scopeOf(req.user, q.divisionId);
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT sec.id, sec.name, sec.division_id, sec.from_station, sec.to_station, sec.length_km,
             ST_AsGeoJSON(ST_SimplifyPreserveTopology(sec.geom, 0.0001))::json AS geometry,
             ST_XMin(sec.geom) AS x0, ST_YMin(sec.geom) AS y0, ST_XMax(sec.geom) AS x1, ST_YMax(sec.geom) AS y1
      FROM sections sec WHERE ${div ? Prisma.sql`sec.division_id = ${div}::uuid` : Prisma.sql`TRUE`} ORDER BY sec.name`;
    return plain(rows);
  });

  /** Segments as GeoJSON coloured by latest risk score (null score => not yet computed). */
  app.get(
    '/v1/map/segments',
    { schema: { tags: ['map'], summary: `Segments with risk score. ${RISK_DISCLAIMER}` } },
    async (req, reply) => {
      const q = Q.parse(req.query);
      const div = scopeOf(req.user, q.divisionId);
      const where = andAll([
        div ? Prisma.sql`sec.division_id = ${div}::uuid` : Prisma.sql`TRUE`,
        q.sectionId ? Prisma.sql`s.section_id = ${q.sectionId}::uuid` : Prisma.sql`TRUE`,
      ]);
      const rows = await prisma.$queryRaw<
        {
          id: string;
          section_id: string;
          chainage_start_m: number;
          chainage_end_m: number;
          is_curve: boolean;
          has_bridge: boolean;
          heat_exposure: number;
          flood_exposure: number;
          score: number | null;
          raw_value: number | null;
          geometry: unknown;
        }[]
      >`
      SELECT s.id, s.section_id, s.chainage_start_m, s.chainage_end_m, s.is_curve, s.has_bridge, s.heat_exposure, s.flood_exposure,
             l.score, l.raw_value, ST_AsGeoJSON(ST_SimplifyPreserveTopology(s.geom, 0.000005))::json AS geometry
      FROM segments s JOIN sections sec ON sec.id = s.section_id
      LEFT JOIN segment_latest_risk l ON l.segment_id = s.id
      WHERE ${where} ORDER BY s.section_id, s.chainage_start_m`;
      reply.header('Cache-Control', 'private, max-age=30');
      return {
        type: 'FeatureCollection',
        features: rows.map((r) => ({
          type: 'Feature',
          id: r.id,
          geometry: r.geometry,
          properties: {
            id: r.id,
            sectionId: r.section_id,
            chainageStartM: r.chainage_start_m,
            chainageEndM: r.chainage_end_m,
            isCurve: r.is_curve,
            hasBridge: r.has_bridge,
            heatExposure: r.heat_exposure,
            floodExposure: r.flood_exposure,
            score: r.score,
            raw: r.raw_value,
          },
        })),
      };
    },
  );

  app.get('/v1/map/crossings', { schema: { tags: ['map'] } }, async (req) => {
    const q = Q.parse(req.query);
    const div = scopeOf(req.user, q.divisionId);
    const since = new Date(Date.now() - 86_400_000);
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT c.id, c.name, c.status::text AS status, ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat,
             d.status::text AS unit_status, d.last_seen_at,
             (SELECT COUNT(*)::int FROM crossing_events e WHERE e.crossing_id = c.id AND e.warning_triggered AND e.occurred_at >= ${since}) AS warnings_24h
      FROM crossings c LEFT JOIN devices d ON d.id = c.unit_id
      WHERE ${div ? Prisma.sql`c.division_id = ${div}::uuid` : Prisma.sql`TRUE`} ORDER BY c.name`;
    return plain(rows);
  });

  const DetQ = Q.extend({
    reviewStatus: z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'NEEDS_INFO']).optional(),
    limit: z.coerce.number().int().min(1).max(3000).default(1500),
  });
  app.get('/v1/map/detections', { schema: { tags: ['map'] } }, async (req) => {
    const q = DetQ.parse(req.query);
    const div = scopeOf(req.user, q.divisionId);
    const where = andAll([
      div ? Prisma.sql`dev.division_id = ${div}::uuid` : Prisma.sql`TRUE`,
      q.reviewStatus
        ? Prisma.sql`d.review_status = ${q.reviewStatus}::"ReviewStatus"`
        : Prisma.sql`d.review_status <> 'REJECTED'`,
    ]);
    const rows = await prisma.$queryRaw<
      {
        id: string;
        lon: number;
        lat: number;
        defect_class: string;
        severity: string;
        confidence: number;
        review_status: string;
        detected_at: Date;
      }[]
    >`
      SELECT d.id, ST_X(d.geom) AS lon, ST_Y(d.geom) AS lat, d.defect_class::text AS defect_class, d.severity::text AS severity,
             d.confidence, d.review_status::text AS review_status, d.detected_at
      FROM detections d JOIN devices dev ON dev.id = d.device_id
      WHERE ${where} ORDER BY d.detected_at DESC LIMIT ${q.limit}`;
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => ({
        type: 'Feature',
        id: r.id,
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: {
          id: r.id,
          defectClass: r.defect_class,
          severity: r.severity,
          confidence: r.confidence,
          reviewStatus: r.review_status,
          detectedAt: r.detected_at,
        },
      })),
    };
  });

  /** Everything the Risk Map side panel needs for one segment. */
  app.get(
    '/v1/segments/:id',
    {
      schema: {
        tags: ['map'],
        summary: `Segment detail with explainable score. ${RISK_DISCLAIMER}`,
      },
    },
    async (req) => {
      const { id } = idParams.parse(req.params);
      await assertSegment(req.user, id);
      const [seg] = await prisma.$queryRaw<unknown[]>`
      SELECT s.id, s.chainage_start_m, s.chainage_end_m, s.is_curve, s.has_bridge, s.heat_exposure, s.flood_exposure,
             s.near_crossing_id, sec.id AS section_id, sec.name AS section_name,
             ST_AsGeoJSON(s.geom)::json AS geometry
      FROM segments s JOIN sections sec ON sec.id = s.section_id WHERE s.id = ${id}::uuid`;
      const [history, detections, workOrders] = await Promise.all([
        prisma.riskScore.findMany({
          where: { segmentId: id },
          orderBy: { computedAt: 'desc' },
          take: 40,
        }),
        prisma.detection.findMany({
          where: { segmentId: id, reviewStatus: { not: 'REJECTED' } },
          orderBy: { detectedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            defectClass: true,
            severity: true,
            confidence: true,
            reviewStatus: true,
            detectedAt: true,
          },
        }),
        prisma.workOrder.findMany({
          where: { segmentId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return plain({
        segment: seg,
        latest: history[0] ?? null,
        history,
        detections,
        workOrders,
        disclaimer: RISK_DISCLAIMER,
      });
    },
  );
}
