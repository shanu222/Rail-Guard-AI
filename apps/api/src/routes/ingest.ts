import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CrossingEventBatchSchema,
  DetectionBatchSchema,
  HeartbeatSchema,
  RunSchema,
  UploadUrlRequestSchema,
  toWktPoint,
  type BatchResult,
} from '@railguard/shared';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from '../lib/auth-plugin';
import { publish } from '../lib/events';
import { makeKey, presignPut } from '../lib/storage';
import { parseDeviceKey, safeEqualHex, sha256 } from '../lib/security';
import { enqueueRisk } from '../queue';

const FUTURE_SKEW_MS = 5 * 60_000;

/** Device time is never trusted: future timestamps are clamped to the server receive time. */
const trustedTime = (deviceIso: string, receivedAt: Date) => {
  const t = new Date(deviceIso);
  return Number.isNaN(t.getTime()) || t.getTime() > receivedAt.getTime() + FUTURE_SKEW_MS
    ? receivedAt
    : t;
};

async function authenticateDevice(req: FastifyRequest) {
  const parsed = parseDeviceKey(req.headers['x-api-key'] as string | undefined);
  if (!parsed) throw new HttpError(401, 'Missing or malformed device key');
  const dev = await prisma.device.findFirst({ where: { apiKeyPrefix: parsed.prefix } });
  if (
    !dev ||
    !dev.apiKeyHash ||
    dev.revokedAt ||
    !safeEqualHex(dev.apiKeyHash, sha256(parsed.secret))
  ) {
    throw new HttpError(401, 'Invalid device key');
  }
  req.device = { id: dev.id, divisionId: dev.divisionId, type: dev.type, isDemo: dev.isDemo };
}

export async function ingestRoutes(app: FastifyInstance) {
  // Accept gzip-compressed request bodies (edge units upload over weak links).
  app.addHook('preParsing', async (req, _reply, payload) => {
    if (req.headers['content-encoding'] === 'gzip') {
      const { createGunzip } = await import('node:zlib');
      delete req.headers['content-length'];
      return payload.pipe(createGunzip());
    }
    return payload;
  });

  app.addHook('onRequest', authenticateDevice);

  const limit = {
    max: env.INGEST_RATE_PER_MIN,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => String(req.headers['x-api-key'] ?? req.ip).slice(0, 16),
  };
  const opts = (summary: string) => ({
    bodyLimit: env.INGEST_MAX_BODY_BYTES,
    config: { rateLimit: limit },
    schema: { tags: ['ingest'], summary, security: [{ deviceKey: [] }] },
  });

  app.post(
    '/v1/ingest/heartbeat',
    opts('Device health, battery, temperature, storage, versions'),
    async (req) => {
      const hb = HeartbeatSchema.parse(req.body);
      const dev = req.device!;
      await prisma.$transaction([
        prisma.device.update({
          where: { id: dev.id },
          data: {
            lastSeenAt: new Date(), // server receive time
            status: 'ONLINE',
            firmwareVersion: hb.firmwareVersion,
            modelVersion: hb.modelVersion,
            batteryPct: hb.batteryPct,
            solarW: hb.solarW,
            temperatureC: hb.temperatureC,
            storagePct: hb.storagePct,
            network: hb.network,
          },
        }),
        prisma.deviceHeartbeat.create({
          data: {
            deviceId: dev.id,
            batteryPct: hb.batteryPct,
            solarW: hb.solarW,
            temperatureC: hb.temperatureC,
            storagePct: hb.storagePct,
            network: hb.network,
            queuedRecords: hb.queuedRecords,
          },
        }),
      ]);
      return { ok: true, serverTime: new Date().toISOString() };
    },
  );

  app.post(
    '/v1/ingest/runs',
    opts('Inspection run summary (upsert by client UUID)'),
    async (req) => {
      const dev = req.device!;
      if (dev.type !== 'TRACK') throw new HttpError(403, 'Only Track Units may post runs');
      const r = RunSchema.parse(req.body);
      const section = await prisma.section.findFirst({
        where: { divisionId: dev.divisionId },
        select: { id: true },
      });
      const existing = await prisma.run.findUnique({ where: { id: r.id } });
      if (existing && existing.deviceId !== dev.id)
        throw new HttpError(409, 'Run id belongs to another device');
      const data = {
        startedAt: new Date(r.startedAt),
        endedAt: r.endedAt ? new Date(r.endedAt) : null,
        distanceKm: r.distanceKm,
        speedAvgKmh: r.speedAvgKmh,
        samplesCount: r.samplesCount ?? 0,
      };
      await prisma.run.upsert({
        where: { id: r.id },
        update: data,
        create: { id: r.id, deviceId: dev.id, sectionId: section?.id ?? null, ...data },
      });
      return { ok: true };
    },
  );

  /** Idempotent: items are keyed by the client UUID; resends are counted as duplicates. */
  app.post(
    '/v1/ingest/detections',
    opts('Batch of detections (idempotent by client UUID)'),
    async (req): Promise<BatchResult> => {
      const dev = req.device!;
      if (dev.type !== 'TRACK') throw new HttpError(403, 'Only Track Units may post detections');
      const { items } = DetectionBatchSchema.parse(req.body);
      const receivedAt = new Date();
      let accepted = 0;
      let duplicates = 0;
      const rejected: BatchResult['rejected'] = [];
      let severe = 0;

      for (const d of items) {
        try {
          const wkt = toWktPoint([d.lon, d.lat]);
          // Snap to the nearest segment within 50 m of this device's division.
          const seg = await prisma.$queryRaw<{ id: string; chainage: number }[]>`
          SELECT s.id,
                 (s.chainage_start_m + ST_LineLocatePoint(s.geom, pt.g) * ST_Length(s.geom::geography))::int AS chainage
          FROM segments s
          JOIN sections sec ON sec.id = s.section_id,
               (SELECT ST_GeomFromText(${wkt}, 4326) AS g) pt
          WHERE sec.division_id = ${dev.divisionId}::uuid
            AND ST_DWithin(s.geom::geography, pt.g::geography, 50)
          ORDER BY ST_Distance(s.geom::geography, pt.g::geography)
          LIMIT 1`;
          const inserted = await prisma.$executeRaw`
          INSERT INTO detections (id, run_id, device_id, segment_id, geom, chainage_m, detected_at, received_at,
                                  defect_class, severity, confidence, sources, fusion_level, image_key, audio_key, bbox, is_demo)
          VALUES (${d.id}::uuid, ${d.runId ?? null}::uuid, ${dev.id}::uuid, ${seg[0]?.id ?? null}::uuid,
                  ST_GeomFromText(${wkt}, 4326), ${seg[0]?.chainage ?? null}, ${trustedTime(d.detectedAt, receivedAt)}, ${receivedAt},
                  ${d.defectClass}::"DefectClass", ${d.severity}::"Severity", ${d.confidence},
                  ${d.sources}::"DetectionSource"[], ${d.fusionLevel}::"FusionLevel", ${d.imageKey ?? null}, ${d.audioKey ?? null}, ${d.bbox ? JSON.stringify(d.bbox) : null}::jsonb, ${dev.isDemo})
          ON CONFLICT (id) DO NOTHING`;
          if (inserted === 0) duplicates++;
          else {
            accepted++;
            if (d.severity === 'SEVERE') {
              severe++;
              await prisma.notification.create({
                data: {
                  divisionId: dev.divisionId,
                  type: 'SEVERE_DETECTION',
                  title: `Severe ${d.defectClass.replaceAll('_', ' ').toLowerCase()} detected`,
                  data: { detectionId: d.id },
                },
              });
              await publish({
                type: 'detection.severe',
                divisionId: dev.divisionId,
                data: { id: d.id, defectClass: d.defectClass, confidence: d.confidence },
              });
            }
          }
        } catch (e) {
          req.log.warn({ err: (e as Error).message, id: d.id }, 'detection rejected');
          rejected.push({ id: d.id, reason: 'database error' });
        }
      }
      if (accepted > 0) await enqueueRisk(dev.divisionId);
      await prisma.device.update({ where: { id: dev.id }, data: { lastSeenAt: receivedAt } });
      req.log.info({ deviceId: dev.id, accepted, duplicates, severe }, 'detections ingested');
      return { accepted, duplicates, rejected };
    },
  );

  app.post(
    '/v1/ingest/crossing-events',
    opts('Batch of crossing events (idempotent by client UUID)'),
    async (req): Promise<BatchResult> => {
      const dev = req.device!;
      if (dev.type !== 'CROSSING')
        throw new HttpError(403, 'Only Crossing Units may post crossing events');
      const crossing = await prisma.crossing.findUnique({ where: { unitId: dev.id } });
      if (!crossing) throw new HttpError(409, 'This unit is not linked to a crossing');
      const { items } = CrossingEventBatchSchema.parse(req.body);
      const receivedAt = new Date();
      let accepted = 0;
      let duplicates = 0;
      for (const e of items) {
        const r = await prisma.crossingEvent.createMany({
          skipDuplicates: true,
          data: [
            {
              id: e.id,
              crossingId: crossing.id,
              deviceId: dev.id,
              occurredAt: trustedTime(e.occurredAt, receivedAt),
              receivedAt,
              objectClass: e.objectClass,
              trainApproaching: e.trainApproaching,
              dwellSeconds: e.dwellSeconds,
              warningTriggered: e.warningTriggered,
              snapshotKey: e.snapshotKey,
              confidence: e.confidence,
              isDemo: dev.isDemo,
            },
          ],
        });
        if (r.count === 0) duplicates++;
        else {
          accepted++;
          if (e.warningTriggered) {
            await publish({
              type: 'crossing.warning',
              divisionId: dev.divisionId,
              data: {
                crossingId: crossing.id,
                name: crossing.name,
                objectClass: e.objectClass,
                at: receivedAt.toISOString(),
              },
            });
          }
        }
      }
      await prisma.device.update({ where: { id: dev.id }, data: { lastSeenAt: receivedAt } });
      return { accepted, duplicates, rejected: [] };
    },
  );

  app.post(
    '/v1/ingest/upload-url',
    opts('Presigned PUT URL for an image or audio clip'),
    async (req) => {
      const body = UploadUrlRequestSchema.parse(req.body);
      const key = makeKey(body.kind, req.device!.id, body.contentType);
      const { url, expiresInSeconds } = await presignPut(key, body.contentType, 300);
      return { key, url, expiresInSeconds };
    },
  );
}
