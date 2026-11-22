import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { HttpError } from '../lib/auth-plugin';
import { idParams, plain, scopeOf } from '../lib/scope';
import { keyOwner, presignGet } from '../lib/storage';

const SAFE = {
  id: true,
  type: true,
  serial: true,
  name: true,
  divisionId: true,
  firmwareVersion: true,
  modelVersion: true,
  lastSeenAt: true,
  batteryPct: true,
  solarW: true,
  temperatureC: true,
  storagePct: true,
  network: true,
  status: true,
  revokedAt: true,
  isDemo: true,
  apiKeyPrefix: true,
} as const; // never expose apiKeyHash

export async function deviceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/v1/devices', { schema: { tags: ['devices'] } }, async (req) => {
    const div = scopeOf(req.user);
    const [devices, activeModels] = await Promise.all([
      prisma.device.findMany({
        where: div ? { divisionId: div } : {},
        select: SAFE,
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      prisma.modelVersion.findMany({
        where: { isActive: true },
        select: { type: true, version: true },
      }),
    ]);
    const now = Date.now();
    return plain({
      devices: devices.map((d) => ({
        ...d,
        minutesSinceSeen: d.lastSeenAt ? Math.round((now - d.lastSeenAt.getTime()) / 60_000) : null,
      })),
      activeModels,
    });
  });

  app.get('/v1/devices/:id', { schema: { tags: ['devices'] } }, async (req) => {
    const { id } = idParams.parse(req.params);
    const q = z
      .object({
        hours: z.coerce
          .number()
          .int()
          .min(1)
          .max(24 * 14)
          .default(72),
      })
      .parse(req.query);
    const d = await prisma.device.findUnique({ where: { id }, select: SAFE });
    if (!d || (req.user.div && d.divisionId !== req.user.div))
      throw new HttpError(404, 'Not found');
    const since = new Date(Date.now() - q.hours * 3_600_000);
    // bucket to <= ~200 points so charts stay light
    const bucketMin = Math.max(5, Math.ceil((q.hours * 60) / 200));
    const series = await prisma.$queryRaw<unknown[]>`
      SELECT to_timestamp(floor(extract(epoch FROM received_at) / ${bucketMin * 60}) * ${bucketMin * 60}) AS at,
             AVG(battery_pct)::float AS battery_pct, AVG(solar_w)::float AS solar_w,
             AVG(temperature_c)::float AS temperature_c, AVG(storage_pct)::float AS storage_pct
      FROM device_heartbeats WHERE device_id = ${id}::uuid AND received_at >= ${since} GROUP BY 1 ORDER BY 1`;
    return plain({ device: d, series });
  });

  /** Short-lived signed GET URL for media. Access is derived from the object key's owner. */
  app.get('/v1/media/url', { schema: { tags: ['media'] } }, async (req) => {
    const { key } = z.object({ key: z.string().min(5).max(300) }).parse(req.query);
    const [kind] = key.split('/');
    const owner = keyOwner(key);
    if (!owner || !/^[0-9a-f-]{36}$/.test(owner)) throw new HttpError(400, 'Bad key');
    let division: string | null | undefined;
    if (kind === 'image' || kind === 'audio' || kind === 'snapshot')
      division = (await prisma.device.findUnique({ where: { id: owner } }))?.divisionId;
    else if (kind === 'evidence') {
      const det = await prisma.detection.findUnique({
        where: { id: owner },
        include: { device: true },
      });
      division =
        det?.device.divisionId ??
        (
          await prisma.workOrder.findUnique({
            where: { id: owner },
            include: { segment: { include: { section: true } } },
          })
        )?.segment.section.divisionId;
    } else if (kind === 'report') division = owner;
    if (!division || (req.user.div && division !== req.user.div))
      throw new HttpError(404, 'Not found');
    return { url: await presignGet(key, 300), expiresInSeconds: 300 };
  });
}
