/**
 * Integration tests against a real PostGIS database. They run only when TEST_DATABASE_URL points at a
 * migrated (`prisma migrate deploy`) database - CI provides one; locally: docker compose up -d && set it.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSegments, toWktLineString, type LonLat } from '@railguard/shared';

const url = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL = url ?? 'postgresql://x:x@localhost:5432/x'; // placeholder when skipped
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret';
process.env.NODE_ENV = 'test';

describe.skipIf(!url)('ingestion (PostGIS)', async () => {
  const { buildApp } = await import('../src/app');
  const { prisma } = await import('../src/db');
  const { generateDeviceKey } = await import('../src/lib/security');
  type App = Awaited<ReturnType<typeof buildApp>>;

  let app: App;
  let key: string;
  let deviceId: string;
  let divisionId: string;
  const line: LonLat[] = [
    [73.0, 33.6],
    [73.02, 33.605],
    [73.04, 33.6],
  ];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const tag = randomUUID().slice(0, 8);
    divisionId = (await prisma.division.create({ data: { name: `Test ${tag}`, code: `T-${tag}` } }))
      .id;
    const sectionId = randomUUID();
    await prisma.$executeRaw`INSERT INTO sections (id, division_id, name, from_station, to_station, length_km, geom)
      VALUES (${sectionId}::uuid, ${divisionId}::uuid, 'Test', 'A', 'B', 4, ST_GeomFromText(${toWktLineString(line)}, 4326))`;
    for (const s of buildSegments(line)) {
      await prisma.$executeRaw`INSERT INTO segments (id, section_id, chainage_start_m, chainage_end_m, geom)
        VALUES (${randomUUID()}::uuid, ${sectionId}::uuid, ${s.chainageStartM}, ${s.chainageEndM}, ST_GeomFromText(${toWktLineString(s.coords)}, 4326))`;
    }
    const k = generateDeviceKey();
    key = k.plaintext;
    deviceId = (
      await prisma.device.create({
        data: {
          type: 'TRACK',
          serial: `T-${tag}`,
          name: 'Test unit',
          divisionId,
          apiKeyHash: k.hash,
          apiKeyPrefix: k.prefix,
          isDemo: true,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.division.delete({ where: { id: divisionId } });
    await app.close();
  });

  const post = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: path,
      payload: payload as object,
      headers: { 'x-api-key': key, ...headers },
    });

  const item = () => ({
    id: randomUUID(),
    detectedAt: new Date().toISOString(),
    lat: 33.6004,
    lon: 73.004,
    defectClass: 'MISSING_FASTENER',
    severity: 'MODERATE',
    confidence: 0.9,
    sources: ['IMAGE', 'VIBRATION'],
    fusionLevel: 'HIGH',
  });

  it('accepts a batch, then treats a resend as duplicates (idempotent)', async () => {
    const items = [item(), item(), item()];
    const a = await post('/v1/ingest/detections', { items });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ accepted: 3, duplicates: 0 });
    const b = await post('/v1/ingest/detections', { items });
    expect(b.json()).toMatchObject({ accepted: 0, duplicates: 3 });
    expect(await prisma.detection.count({ where: { id: { in: items.map((i) => i.id) } } })).toBe(3);
  });

  it('snaps detections to a segment and stores the server receive time', async () => {
    const it1 = item();
    await post('/v1/ingest/detections', { items: [it1] });
    const row = await prisma.detection.findUniqueOrThrow({ where: { id: it1.id } });
    expect(row.segmentId).not.toBeNull();
    expect(row.chainageM).not.toBeNull();
    expect(row.receivedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('clamps device timestamps from the future to the server time', async () => {
    const it2 = { ...item(), detectedAt: new Date(Date.now() + 7 * 86_400_000).toISOString() };
    await post('/v1/ingest/detections', { items: [it2] });
    const row = await prisma.detection.findUniqueOrThrow({ where: { id: it2.id } });
    expect(row.detectedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('rejects a revoked device key and malformed payloads', async () => {
    expect((await post('/v1/ingest/detections', { items: [{ id: 'nope' }] })).statusCode).toBe(400);
    await prisma.device.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    expect((await post('/v1/ingest/heartbeat', {})).statusCode).toBe(401);
  });
});
