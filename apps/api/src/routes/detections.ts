import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFECT_CLASSES, REVIEW_STATUSES, SEVERITIES } from '@railguard/shared';
import { prisma, Prisma, andAll } from '../db';
import { audit } from '../lib/audit';
import { HttpError, requirePerm } from '../lib/auth-plugin';
import {
  decodeCursor,
  encodeCursor,
  idParams,
  inspectorSectionIds,
  plain,
  scopeOf,
  sqlList,
} from '../lib/scope';
import { makeKey, presignGet, presignPut } from '../lib/storage';
import { enqueueRisk } from '../queue';

const Filters = z.object({
  divisionId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  segmentId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  defectClass: z.enum(DEFECT_CLASSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
});
const List = Filters.extend({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

type Row = {
  id: string;
  detected_at: Date;
  defect_class: string;
  severity: string;
  confidence: number;
  sources: string[];
  fusion_level: string;
  review_status: string;
  image_key: string | null;
  chainage_m: number | null;
  lon: number;
  lat: number;
  section_name: string | null;
  device_name: string;
  is_demo: boolean;
  distance_m?: number | null;
};

const SELECT = Prisma.sql`
  d.id, d.detected_at, d.defect_class::text AS defect_class, d.severity::text AS severity, d.confidence,
  d.sources::text[] AS sources, d.fusion_level::text AS fusion_level, d.review_status::text AS review_status,
  d.image_key, d.chainage_m, ST_X(d.geom) AS lon, ST_Y(d.geom) AS lat, sec.name AS section_name, dev.name AS device_name, d.is_demo`;
const FROM = Prisma.sql`
  FROM detections d JOIN devices dev ON dev.id = d.device_id
  LEFT JOIN segments s ON s.id = d.segment_id LEFT JOIN sections sec ON sec.id = s.section_id`;

async function whereFor(
  req: { user: import('../lib/auth-plugin').JwtUser },
  f: z.infer<typeof Filters>,
) {
  const div = scopeOf(req.user, f.divisionId);
  const sections = await inspectorSectionIds(req.user);
  return [
    div ? Prisma.sql`dev.division_id = ${div}::uuid` : Prisma.sql`TRUE`,
    f.sectionId ? Prisma.sql`s.section_id = ${f.sectionId}::uuid` : Prisma.sql`TRUE`,
    sections ? Prisma.sql`s.section_id = ${sqlList(sections)}` : Prisma.sql`TRUE`,
    f.segmentId ? Prisma.sql`d.segment_id = ${f.segmentId}::uuid` : Prisma.sql`TRUE`,
    f.from ? Prisma.sql`d.detected_at >= ${f.from}` : Prisma.sql`TRUE`,
    f.to ? Prisma.sql`d.detected_at <= ${f.to}` : Prisma.sql`TRUE`,
    f.defectClass ? Prisma.sql`d.defect_class = ${f.defectClass}::"DefectClass"` : Prisma.sql`TRUE`,
    f.severity ? Prisma.sql`d.severity = ${f.severity}::"Severity"` : Prisma.sql`TRUE`,
    f.reviewStatus
      ? Prisma.sql`d.review_status = ${f.reviewStatus}::"ReviewStatus"`
      : Prisma.sql`TRUE`,
  ];
}

const camel = (r: Row) => ({
  id: r.id,
  detectedAt: r.detected_at,
  defectClass: r.defect_class,
  severity: r.severity,
  confidence: r.confidence,
  sources: r.sources,
  fusionLevel: r.fusion_level,
  reviewStatus: r.review_status,
  hasImage: !!r.image_key,
  chainageM: r.chainage_m,
  lon: r.lon,
  lat: r.lat,
  sectionName: r.section_name,
  deviceName: r.device_name,
  isDemo: r.is_demo,
  distanceM: r.distance_m ?? null,
});

export async function detectionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/v1/detections',
    { schema: { tags: ['detections'], summary: 'Cursor-paginated list with filters' } },
    async (req) => {
      const q = List.parse(req.query);
      const cur = decodeCursor<{ t: string; id: string }>(q.cursor);
      const where = andAll([
        ...(await whereFor(req, q)),
        cur
          ? Prisma.sql`(d.detected_at, d.id) < (${new Date(cur.t)}, ${cur.id}::uuid)`
          : Prisma.sql`TRUE`,
      ]);
      const rows = await prisma.$queryRaw<
        Row[]
      >`SELECT ${SELECT} ${FROM} WHERE ${where} ORDER BY d.detected_at DESC, d.id DESC LIMIT ${q.limit + 1}`;
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return plain({
        items: page.map(camel),
        nextCursor:
          rows.length > q.limit && last
            ? encodeCursor({ t: last.detected_at.toISOString(), id: last.id })
            : null,
      });
    },
  );

  /** Inspector queue: PENDING detections nearest the inspector (or newest first without a location). */
  app.get('/v1/detections/queue', { schema: { tags: ['detections'] } }, async (req) => {
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lon: z.coerce.number().min(-180).max(180).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(req.query);
    const where = andAll([...(await whereFor(req, { reviewStatus: 'PENDING' }))]);
    const hasLoc = q.lat !== undefined && q.lon !== undefined;
    const rows = hasLoc
      ? await prisma.$queryRaw<Row[]>`
          SELECT ${SELECT}, ST_Distance(d.geom::geography, ST_SetSRID(ST_MakePoint(${q.lon!}, ${q.lat!}), 4326)::geography) AS distance_m
          ${FROM} WHERE ${where} ORDER BY distance_m ASC LIMIT ${q.limit}`
      : await prisma.$queryRaw<
          Row[]
        >`SELECT ${SELECT} ${FROM} WHERE ${where} ORDER BY d.severity DESC, d.detected_at DESC LIMIT ${q.limit}`;
    return plain({ items: rows.map(camel) });
  });

  app.get(
    '/v1/detections/export.csv',
    { preHandler: requirePerm(app, 'reports:read'), schema: { tags: ['detections'] } },
    async (req, reply) => {
      const q = Filters.parse(req.query);
      const rows = await prisma.$queryRaw<
        Row[]
      >`SELECT ${SELECT} ${FROM} WHERE ${andAll(await whereFor(req, q))} ORDER BY d.detected_at DESC LIMIT 50000`;
      const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
      const header =
        'id,detected_at,defect_class,severity,confidence,fusion_level,review_status,section,chainage_m,lat,lon,device,demo';
      const body = rows.map((r) =>
        [
          r.id,
          r.detected_at.toISOString(),
          r.defect_class,
          r.severity,
          r.confidence.toFixed(3),
          r.fusion_level,
          r.review_status,
          r.section_name,
          r.chainage_m,
          r.lat,
          r.lon,
          r.device_name,
          r.is_demo,
        ]
          .map(esc)
          .join(','),
      );
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="detections.csv"');
      return [header, ...body].join('\n');
    },
  );

  app.get('/v1/detections/:id', { schema: { tags: ['detections'] } }, async (req) => {
    const { id } = idParams.parse(req.params);
    const rows = await prisma.$queryRaw<
      (Row & {
        audio_key: string | null;
        review_note: string | null;
        reviewed_at: Date | null;
        reviewer: string | null;
        segment_id: string | null;
        evidence_keys: string[] | null;
        division_id: string;
        bbox: number[] | null;
      })[]
    >`
      SELECT ${SELECT}, d.audio_key, d.review_note, d.reviewed_at, u.name AS reviewer, d.segment_id, d.evidence_keys, dev.division_id, d.bbox
      ${FROM} LEFT JOIN users u ON u.id = d.reviewed_by WHERE d.id = ${id}::uuid`;
    const r = rows[0];
    if (!r || (req.user.div && r.division_id !== req.user.div))
      throw new HttpError(404, 'Not found');
    const keys = await prisma.detection.findUniqueOrThrow({
      where: { id },
      select: { imageKey: true, audioKey: true, evidenceKeys: true },
    });
    return plain({
      ...camel(r),
      segmentId: r.segment_id,
      bbox: r.bbox,
      reviewNote: r.review_note,
      reviewedAt: r.reviewed_at,
      reviewer: r.reviewer,
      imageUrl: keys.imageKey ? await presignGet(keys.imageKey, 300) : null,
      audioUrl: keys.audioKey ? await presignGet(keys.audioKey, 300) : null,
      evidenceUrls: await Promise.all((keys.evidenceKeys ?? []).map((k) => presignGet(k, 300))),
    });
  });

  const ReviewBody = z.object({
    status: z.enum(['CONFIRMED', 'REJECTED', 'NEEDS_INFO']),
    note: z.string().max(1000).optional(),
    evidenceKeys: z.array(z.string().max(300)).max(6).optional(),
  });
  app.post(
    '/v1/detections/:id/review',
    {
      preHandler: requirePerm(app, 'detections:review'),
      schema: { tags: ['detections'], summary: 'Confirm / reject / needs-info' },
    },
    async (req) => {
      const { id } = idParams.parse(req.params);
      const body = ReviewBody.parse(req.body);
      const cur = await prisma.detection.findUnique({
        where: { id },
        include: { device: { select: { divisionId: true } } },
      });
      if (!cur || (req.user.div && cur.device.divisionId !== req.user.div))
        throw new HttpError(404, 'Not found');
      if (body.evidenceKeys?.some((k) => !k.startsWith(`evidence/${id}/`)))
        throw new HttpError(400, 'Invalid evidence key');
      const updated = await prisma.detection.update({
        where: { id },
        data: {
          reviewStatus: body.status,
          reviewNote: body.note,
          reviewedById: req.user.sub,
          reviewedAt: new Date(),
          ...(body.evidenceKeys?.length ? { evidenceKeys: { push: body.evidenceKeys } } : {}),
        },
      });
      await audit(
        req,
        'detection.review',
        'detection',
        id,
        { status: cur.reviewStatus },
        { status: body.status, note: body.note },
      );
      await enqueueRisk(cur.device.divisionId, { delayMs: 5_000 }); // review changes the defect component
      return { id, reviewStatus: updated.reviewStatus };
    },
  );

  /** Presigned PUT for an inspector's field photo (no device key needed - inspector JWT). */
  app.post(
    '/v1/detections/:id/evidence-url',
    { preHandler: requirePerm(app, 'detections:review'), schema: { tags: ['detections'] } },
    async (req) => {
      const { id } = idParams.parse(req.params);
      const b = z.object({ contentType: z.enum(['image/jpeg', 'image/png']) }).parse(req.body);
      const cur = await prisma.detection.findUnique({
        where: { id },
        include: { device: { select: { divisionId: true } } },
      });
      if (!cur || (req.user.div && cur.device.divisionId !== req.user.div))
        throw new HttpError(404, 'Not found');
      const key = makeKey('evidence', id, b.contentType);
      return { key, ...(await presignPut(key, b.contentType, 300)) };
    },
  );
}
