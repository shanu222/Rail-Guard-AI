import type { FastifyInstance } from 'fastify';
import argon2 from 'argon2';
import { DOMParser } from '@xmldom/xmldom';
import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { z } from 'zod';
import {
  CROSSING_STATUSES,
  CreateUserSchema,
  DEVICE_TYPES,
  MODEL_TYPES,
  PasswordSchema,
  RiskConfigSchema,
  ROLES,
  buildSegments,
  lineLengthM,
  toWktLineString,
  type LonLat,
} from '@railguard/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { clearDemo, demoStatus, loadDemo } from '../lib/demo';
import { storageCheck } from '../lib/storage';
import { HttpError, requirePerm } from '../lib/auth-plugin';
import { generateDeviceKey } from '../lib/security';
import { idParams, plain, scopeOf, Uuid } from '../lib/scope';
import { enqueueRisk } from '../queue';
import { loadRiskConfig, previewConfig } from '../risk/run';

/** Extract one continuous track line from GeoJSON or KML text. */
export function parseTrackLine(format: 'geojson' | 'kml', text: string): LonLat[] {
  let gj: unknown;
  try {
    gj =
      format === 'kml'
        ? kmlToGeoJson(new DOMParser().parseFromString(text, 'text/xml') as never)
        : JSON.parse(text);
  } catch {
    throw new HttpError(400, `Could not parse ${format.toUpperCase()} file`);
  }
  const lines: LonLat[][] = [];
  const visit = (g: any): void => {
    if (!g) return;
    if (g.type === 'FeatureCollection') g.features?.forEach(visit);
    else if (g.type === 'Feature') visit(g.geometry);
    else if (g.type === 'GeometryCollection') g.geometries?.forEach(visit);
    else if (g.type === 'LineString')
      lines.push(g.coordinates.map((c: number[]) => [c[0], c[1]] as LonLat));
    else if (g.type === 'MultiLineString')
      g.coordinates.forEach((l: number[][]) => lines.push(l.map((c) => [c[0], c[1]] as LonLat)));
  };
  visit(gj);
  if (!lines.length) throw new HttpError(400, 'No LineString found in file');
  const coords = lines.flat();
  if (
    coords.length < 2 ||
    coords.some(
      ([x, y]) =>
        !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90,
    )
  )
    throw new HttpError(400, 'Invalid coordinates (expected WGS84 lon/lat)');
  return coords;
}

async function linkSegmentsToCrossings(divisionId: string) {
  await prisma.$executeRaw`
    UPDATE segments s SET near_crossing_id = (
      SELECT c.id FROM crossings c WHERE c.division_id = ${divisionId}::uuid AND ST_DWithin(c.geom::geography, s.geom::geography, 300)
      ORDER BY ST_Distance(c.geom::geography, s.geom::geography) LIMIT 1)
    WHERE s.section_id IN (SELECT id FROM sections WHERE division_id = ${divisionId}::uuid)`;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get(
    '/v1/divisions',
    { preHandler: app.authenticate, schema: { tags: ['admin'] } },
    async (req) => {
      const div = scopeOf(req.user);
      return prisma.division.findMany({ where: div ? { id: div } : {}, orderBy: { name: 'asc' } });
    },
  );

  const admin = (p: Parameters<typeof requirePerm>[1]) => ({
    preHandler: requirePerm(app, p),
    schema: { tags: ['admin'] },
  });

  // ---------- users ----------
  app.get('/v1/admin/users', admin('users:manage'), async () =>
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        divisionId: true,
        isActive: true,
        totpEnabled: true,
        lastLoginAt: true,
        lockedUntil: true,
      },
      orderBy: { name: 'asc' },
    }),
  );

  app.post('/v1/admin/users', admin('users:manage'), async (req, reply) => {
    const b = CreateUserSchema.parse(req.body);
    if (b.role !== 'ADMIN' && !b.divisionId)
      throw new HttpError(400, 'Non-admin users need a division');
    if (await prisma.user.findUnique({ where: { email: b.email } }))
      throw new HttpError(409, 'Email already in use');
    const u = await prisma.user.create({
      data: {
        email: b.email,
        name: b.name,
        role: b.role,
        divisionId: b.divisionId,
        passwordHash: await argon2.hash(b.password, { type: argon2.argon2id }),
      },
      select: { id: true, email: true, role: true },
    });
    await audit(req, 'user.create', 'user', u.id, null, { ...b, password: undefined });
    return reply.code(201).send(u);
  });

  app.patch('/v1/admin/users/:id', admin('users:manage'), async (req) => {
    const { id } = idParams.parse(req.params);
    const b = z
      .object({
        name: z.string().min(1).max(120).optional(),
        role: z.enum(ROLES).optional(),
        divisionId: Uuid.nullable().optional(),
        isActive: z.boolean().optional(),
        password: PasswordSchema.optional(),
        unlock: z.boolean().optional(),
        sectionIds: z.array(Uuid).optional(),
      })
      .parse(req.body);
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, 'Not found');
    if (id === req.user.sub && (b.isActive === false || (b.role && b.role !== 'ADMIN')))
      throw new HttpError(400, 'You cannot demote or deactivate yourself');
    const u = await prisma.user.update({
      where: { id },
      data: {
        name: b.name,
        role: b.role,
        divisionId: b.divisionId,
        isActive: b.isActive,
        ...(b.password
          ? { passwordHash: await argon2.hash(b.password, { type: argon2.argon2id }) }
          : {}),
        ...(b.unlock ? { failedLogins: 0, lockedUntil: null } : {}),
      },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (b.sectionIds) {
      await prisma.userSection.deleteMany({ where: { userId: id } });
      await prisma.userSection.createMany({
        data: b.sectionIds.map((sectionId) => ({ userId: id, sectionId })),
      });
    }
    if (b.isActive === false || b.password)
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    await audit(
      req,
      'user.update',
      'user',
      id,
      { role: before.role, isActive: before.isActive },
      { ...b, password: undefined },
    );
    return u;
  });

  // ---------- divisions ----------
  app.post('/v1/admin/divisions', admin('users:manage'), async (req, reply) => {
    const b = z
      .object({
        name: z.string().min(2).max(120),
        code: z
          .string()
          .min(2)
          .max(20)
          .regex(/^[A-Z0-9-]+$/),
      })
      .parse(req.body);
    const d = await prisma.division.create({ data: b });
    await audit(req, 'division.create', 'division', d.id, null, b);
    return reply.code(201).send(d);
  });

  // ---------- sections (GeoJSON / KML upload => 100 m segments) ----------
  app.post(
    '/v1/admin/sections',
    { ...admin('sections:manage'), bodyLimit: 10 * 1024 * 1024 },
    async (req, reply) => {
      const b = z
        .object({
          divisionId: Uuid,
          name: z.string().min(2).max(120),
          fromStation: z.string().min(1).max(80),
          toStation: z.string().min(1).max(80),
          format: z.enum(['geojson', 'kml']),
          data: z.string().min(10),
          segmentLengthM: z.number().int().min(25).max(500).default(100),
        })
        .parse(req.body);
      const coords = parseTrackLine(b.format, b.data);
      const lengthM = lineLengthM(coords);
      if (lengthM < 200 || lengthM > 600_000)
        throw new HttpError(
          400,
          `Track length ${(lengthM / 1000).toFixed(1)} km is outside the accepted range (0.2 - 600 km)`,
        );
      const segs = buildSegments(coords, b.segmentLengthM);
      const sectionId = crypto.randomUUID();
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`INSERT INTO sections (id, division_id, name, from_station, to_station, length_km, geom)
        VALUES (${sectionId}::uuid, ${b.divisionId}::uuid, ${b.name}, ${b.fromStation}, ${b.toStation}, ${Number((lengthM / 1000).toFixed(3))}, ST_GeomFromText(${toWktLineString(coords)}, 4326))`;
          for (const s of segs) {
            await tx.$executeRaw`INSERT INTO segments (id, section_id, chainage_start_m, chainage_end_m, geom, is_curve)
          VALUES (${crypto.randomUUID()}::uuid, ${sectionId}::uuid, ${s.chainageStartM}, ${s.chainageEndM}, ST_GeomFromText(${toWktLineString(s.coords)}, 4326), ${s.isCurve})`;
          }
        },
        { timeout: 120_000 },
      );
      await linkSegmentsToCrossings(b.divisionId);
      await audit(req, 'section.create', 'section', sectionId, null, {
        name: b.name,
        km: lengthM / 1000,
        segments: segs.length,
      });
      await enqueueRisk(b.divisionId, { force: true, delayMs: 1000 });
      return reply
        .code(201)
        .send({ id: sectionId, lengthKm: lengthM / 1000, segments: segs.length });
    },
  );

  app.patch('/v1/admin/segments/:id', admin('sections:manage'), async (req) => {
    const { id } = idParams.parse(req.params);
    const b = z
      .object({
        hasBridge: z.boolean().optional(),
        isCurve: z.boolean().optional(),
        heatExposure: z.number().min(0).max(1).optional(),
        floodExposure: z.number().min(0).max(1).optional(),
      })
      .parse(req.body);
    const s = await prisma.segment.update({ where: { id }, data: b });
    await audit(req, 'segment.update', 'segment', id, null, b);
    return s;
  });

  // ---------- crossings ----------
  app.post('/v1/admin/crossings', admin('sections:manage'), async (req, reply) => {
    const b = z
      .object({
        divisionId: Uuid,
        name: z.string().min(2).max(120),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        unitId: Uuid.nullable().optional(),
        dangerZone: z
          .array(z.tuple([z.number(), z.number()]))
          .min(3)
          .optional(),
      })
      .parse(req.body);
    const id = crypto.randomUUID();
    await prisma.$executeRaw`INSERT INTO crossings (id, division_id, name, geom, status, danger_zone, unit_id)
      VALUES (${id}::uuid, ${b.divisionId}::uuid, ${b.name}, ST_SetSRID(ST_MakePoint(${b.lon}, ${b.lat}), 4326), 'ACTIVE'::"CrossingStatus", ${b.dangerZone ? JSON.stringify(b.dangerZone) : null}::jsonb, ${b.unitId ?? null}::uuid)`;
    await linkSegmentsToCrossings(b.divisionId);
    await audit(req, 'crossing.create', 'crossing', id, null, b);
    return reply.code(201).send({ id });
  });

  app.patch('/v1/admin/crossings/:id', admin('sections:manage'), async (req) => {
    const { id } = idParams.parse(req.params);
    const b = z
      .object({
        name: z.string().min(2).max(120).optional(),
        status: z.enum(CROSSING_STATUSES).optional(),
        unitId: Uuid.nullable().optional(),
        dangerZone: z
          .array(z.tuple([z.number(), z.number()]))
          .min(3)
          .optional(),
      })
      .parse(req.body);
    const c = await prisma.crossing.update({ where: { id }, data: b });
    await audit(req, 'crossing.update', 'crossing', id, null, b);
    return { id: c.id };
  });

  // ---------- devices ----------
  app.post('/v1/admin/devices', admin('devices:manage'), async (req, reply) => {
    const b = z
      .object({
        type: z.enum(DEVICE_TYPES),
        serial: z.string().min(3).max(60),
        name: z.string().min(2).max(80),
        divisionId: Uuid,
      })
      .parse(req.body);
    if (await prisma.device.findUnique({ where: { serial: b.serial } }))
      throw new HttpError(409, 'Serial already registered');
    const key = generateDeviceKey();
    const d = await prisma.device.create({
      data: { ...b, apiKeyHash: key.hash, apiKeyPrefix: key.prefix, status: 'OFFLINE' },
      select: { id: true, serial: true },
    });
    await audit(req, 'device.create', 'device', d.id, null, b);
    // The plaintext key is returned ONCE and never stored.
    return reply.code(201).send({
      ...d,
      apiKey: key.plaintext,
      note: 'Store this key now - it cannot be shown again.',
    });
  });

  app.post('/v1/admin/devices/:id/rotate-key', admin('devices:manage'), async (req) => {
    const { id } = idParams.parse(req.params);
    const key = generateDeviceKey();
    await prisma.device.update({
      where: { id },
      data: { apiKeyHash: key.hash, apiKeyPrefix: key.prefix, revokedAt: null },
    });
    await audit(req, 'device.rotate_key', 'device', id);
    return { id, apiKey: key.plaintext, note: 'Store this key now - it cannot be shown again.' };
  });

  app.post('/v1/admin/devices/:id/revoke', admin('devices:manage'), async (req) => {
    const { id } = idParams.parse(req.params);
    await prisma.device.update({
      where: { id },
      data: { revokedAt: new Date(), status: 'OFFLINE' },
    });
    await audit(req, 'device.revoke', 'device', id);
    return { id, revoked: true };
  });

  // ---------- model versions ----------
  app.get(
    '/v1/admin/model-versions',
    { preHandler: app.authenticate, schema: { tags: ['admin'] } },
    async () => prisma.modelVersion.findMany({ orderBy: { releasedAt: 'desc' } }),
  );
  app.post('/v1/admin/model-versions', admin('models:manage'), async (req, reply) => {
    const b = z
      .object({
        type: z.enum(MODEL_TYPES),
        version: z.string().min(1).max(40),
        metrics: z.record(z.unknown()).optional(),
        r2Key: z.string().max(300).optional(),
      })
      .parse(req.body);
    const m = await prisma.modelVersion.create({
      data: { type: b.type, version: b.version, metrics: b.metrics as never, r2Key: b.r2Key },
    });
    await audit(req, 'model.create', 'model_version', m.id, null, b);
    return reply.code(201).send(m);
  });
  app.post('/v1/admin/model-versions/:id/activate', admin('models:manage'), async (req) => {
    const { id } = idParams.parse(req.params);
    const m = await prisma.modelVersion.findUniqueOrThrow({ where: { id } });
    await prisma.$transaction([
      prisma.modelVersion.updateMany({ where: { type: m.type }, data: { isActive: false } }),
      prisma.modelVersion.update({ where: { id }, data: { isActive: true } }),
    ]);
    await audit(req, 'model.activate', 'model_version', id);
    return { id, active: true };
  });

  // ---------- risk weights editor ----------
  app.get(
    '/v1/admin/risk-config',
    { preHandler: app.authenticate, schema: { tags: ['admin'] } },
    async () => loadRiskConfig(),
  );

  app.post('/v1/admin/risk-config/preview', admin('risk-weights:approve'), async (req) => {
    const b = z.object({ divisionId: Uuid, config: RiskConfigSchema }).parse(req.body);
    return plain(await previewConfig(scopeOf(req.user, b.divisionId)!, b.config));
  });

  app.put('/v1/admin/risk-config', admin('risk-weights:approve'), async (req) => {
    const cfg = RiskConfigSchema.parse(req.body);
    const bounds = cfg.thresholds.bounds;
    if (bounds.some((v, i) => i > 0 && v < bounds[i - 1]!))
      throw new HttpError(400, 'Thresholds must be ascending');
    if (cfg.thresholds.mode === 'quantile' && bounds.some((v) => v < 0 || v > 1))
      throw new HttpError(400, 'Quantile thresholds must be between 0 and 1');
    const before = await loadRiskConfig();
    await prisma.setting.upsert({
      where: { key: 'risk_config' },
      update: { value: cfg as never, updatedBy: req.user.sub },
      create: { key: 'risk_config', value: cfg as never, updatedBy: req.user.sub },
    });
    await audit(req, 'risk_config.update', 'setting', 'risk_config', before, cfg);
    const divisions = await prisma.division.findMany({
      where: req.user.div ? { id: req.user.div } : {},
      select: { id: true },
    });
    for (const d of divisions) await enqueueRisk(d.id, { force: true, delayMs: 1000 }); // weights changed => recalculate
    return { ok: true, recalculating: divisions.length };
  });

  app.post('/v1/admin/risk/recalculate', admin('risk-weights:approve'), async (req) => {
    const div = scopeOf(req.user, (req.body as { divisionId?: string } | undefined)?.divisionId);
    const divisions = await prisma.division.findMany({
      where: div ? { id: div } : {},
      select: { id: true },
    });
    for (const d of divisions) await enqueueRisk(d.id, { force: true, delayMs: 500 });
    return { queued: divisions.length };
  });

  // ---------- settings & weather ----------
  app.get(
    '/v1/admin/settings',
    { preHandler: app.authenticate, schema: { tags: ['admin'] } },
    async () => {
      const rows = await prisma.setting.findMany({
        where: {
          key: { in: ['inspection_baseline_min_per_km', 'snapshot_retention_days', 'pilot_eval'] },
        },
      });
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  );

  const SettingValues: Record<string, z.ZodTypeAny> = {
    inspection_baseline_min_per_km: z.number().positive().max(10_000).nullable(),
    snapshot_retention_days: z.number().int().min(1).max(365),
    pilot_eval: z.object({
      trackRecall: z.number().min(0).max(1).nullable(),
      trackSamples: z.number().int().min(0).nullable(),
      crossingDayRecall: z.number().min(0).max(1).nullable(),
      crossingDaySamples: z.number().int().min(0).nullable(),
      crossingNightRecall: z.number().min(0).max(1).nullable(),
      crossingNightSamples: z.number().int().min(0).nullable(),
    }),
  };
  app.put('/v1/admin/settings/:key', admin('settings:manage'), async (req) => {
    const { key } = z
      .object({ key: z.enum(Object.keys(SettingValues) as [string, ...string[]]) })
      .parse(req.params);
    const value = SettingValues[key]!.parse((req.body as { value?: unknown })?.value);
    await prisma.setting.upsert({
      where: { key },
      update: { value, updatedBy: req.user.sub },
      create: { key, value, updatedBy: req.user.sub },
    });
    await audit(req, 'setting.update', 'setting', key, null, value);
    return { key, value };
  });

  app.post('/v1/admin/weather', admin('settings:manage'), async (req, reply) => {
    const b = z
      .object({
        sectionId: Uuid,
        entries: z
          .array(
            z.object({
              date: z.coerce.date(),
              maxTempC: z.number().min(-20).max(60).nullable(),
              rainfallMm: z.number().min(0).max(1000).nullable(),
              floodFlag: z.boolean().default(false),
            }),
          )
          .min(1)
          .max(120),
      })
      .parse(req.body);
    await prisma.weatherInput.createMany({
      data: b.entries.map((e) => ({ sectionId: b.sectionId, ...e })),
    });
    await audit(req, 'weather.create', 'section', b.sectionId, null, { entries: b.entries.length });
    const sec = await prisma.section.findUniqueOrThrow({ where: { id: b.sectionId } });
    await enqueueRisk(sec.divisionId, { force: true, delayMs: 1000 });
    return reply.code(201).send({ added: b.entries.length });
  });

  app.get('/v1/admin/audit', admin('users:manage'), async (req) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query);
    return prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true } } },
    });
  });

  // ---- storage (Cloudflare R2) self-test ----
  app.get('/v1/admin/storage-check', admin('settings:manage'), async () => storageCheck());

  // ---- demo data: load / remove from the Admin screen (Admin only) ----
  app.get('/v1/admin/demo', admin('users:manage'), async () => demoStatus());

  app.post('/v1/admin/demo/load', admin('users:manage'), async (req) => {
    const b = z.object({ days: z.number().int().min(7).max(90).default(45) }).parse(req.body ?? {});
    const result = await loadDemo({ days: b.days });
    await audit(req, 'demo.load', 'system', null, null, result);
    return result;
  });

  app.post('/v1/admin/demo/clear', admin('users:manage'), async (req) => {
    const result = await clearDemo();
    await audit(req, 'demo.clear', 'system', null, null, result.removed);
    return result;
  });
}
