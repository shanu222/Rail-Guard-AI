import { z } from 'zod';
import {
  CrossingObjectClassSchema,
  DefectClassSchema,
  DetectionSourceSchema,
  FusionLevelSchema,
  NetworkTypeSchema,
  SeveritySchema,
} from './enums';

export const MAX_BATCH_ITEMS = 500;

const Lat = z.number().min(-90).max(90);
const Lon = z.number().min(-180).max(180);
const IsoDate = z.string().datetime({ offset: true });

/** POST /v1/ingest/heartbeat */
export const HeartbeatSchema = z.object({
  deviceTime: IsoDate,
  firmwareVersion: z.string().max(40),
  modelVersion: z.string().max(40),
  batteryPct: z.number().min(0).max(100).optional(),
  solarW: z.number().min(0).max(1000).optional(),
  temperatureC: z.number().min(-40).max(120).optional(),
  storagePct: z.number().min(0).max(100).optional(),
  network: NetworkTypeSchema.optional(),
  lat: Lat.optional(),
  lon: Lon.optional(),
  /** Number of records waiting on the device to be uploaded (store-and-forward backlog). */
  queuedRecords: z.number().int().min(0).optional(),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

/** One detection. `id` is a client-generated UUID so resends are idempotent. */
export const DetectionItemSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid().optional(),
  detectedAt: IsoDate, // device time; the server also stores its own received_at
  lat: Lat,
  lon: Lon,
  defectClass: DefectClassSchema,
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  sources: z.array(DetectionSourceSchema).min(1).max(3),
  fusionLevel: FusionLevelSchema,
  imageKey: z.string().max(300).optional(),
  audioKey: z.string().max(300).optional(),
  /** Bounding box in the image, normalised 0..1: [x, y, width, height] from the top-left. */
  bbox: z
    .tuple([
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
      z.number().min(0).max(1),
    ])
    .optional(),
});
export type DetectionItem = z.infer<typeof DetectionItemSchema>;

export const DetectionBatchSchema = z.object({
  items: z.array(DetectionItemSchema).min(1).max(MAX_BATCH_ITEMS),
});
export type DetectionBatch = z.infer<typeof DetectionBatchSchema>;

export const CrossingEventItemSchema = z.object({
  id: z.string().uuid(),
  occurredAt: IsoDate,
  objectClass: CrossingObjectClassSchema,
  trainApproaching: z.boolean(),
  dwellSeconds: z.number().min(0).max(3600),
  warningTriggered: z.boolean(),
  confidence: z.number().min(0).max(1),
  snapshotKey: z.string().max(300).optional(),
});
export type CrossingEventItem = z.infer<typeof CrossingEventItemSchema>;

/** POST /v1/ingest/runs - an inspection run (trolley/locomotive pass). Upserted by client UUID. */
export const RunSchema = z.object({
  id: z.string().uuid(),
  startedAt: IsoDate,
  endedAt: IsoDate.optional(),
  distanceKm: z.number().min(0).max(2000).optional(),
  speedAvgKmh: z.number().min(0).max(300).optional(),
  samplesCount: z.number().int().min(0).optional(),
});
export type RunItem = z.infer<typeof RunSchema>;

export const CrossingEventBatchSchema = z.object({
  items: z.array(CrossingEventItemSchema).min(1).max(MAX_BATCH_ITEMS),
});

/** POST /v1/ingest/upload-url */
export const UploadUrlRequestSchema = z.object({
  kind: z.enum(['image', 'audio', 'snapshot']),
  contentType: z.enum(['image/jpeg', 'image/png', 'audio/wav', 'audio/mpeg', 'audio/ogg']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});
export const UploadUrlResponseSchema = z.object({
  key: z.string(),
  url: z.string().url(),
  expiresInSeconds: z.number().int(),
});

export const BatchResultSchema = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  rejected: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type BatchResult = z.infer<typeof BatchResultSchema>;
