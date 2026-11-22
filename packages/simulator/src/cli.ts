/**
 * RAILGUARD AI device simulator (DEMO DATA ONLY).
 * 2 Track Units + 3 Crossing Units that behave like real edge devices against the real ingestion API.
 *
 *   pnpm sim backfill --days 45     populate history (detections, crossing events, runs, heartbeats)
 *   pnpm sim run                    live loop: heartbeats, detections, crossing events, offline/resend cycles
 *   pnpm sim offline-test           send a batch, resend it, and verify the server de-duplicated it
 *
 * Options: --api http://localhost:4000   --keys path/to/.device-keys.json
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pointAlong,
  type CrossingObjectClass,
  type DefectClass,
  type LonLat,
  type Severity,
} from '@railguard/shared';
import { buildDemoGeography, DEMO_DEVICES, mulberry32 } from '../../../apps/api/prisma/demo-data';
import { DeviceClient } from './client';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'run';
const opt = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : def;
};
const apiUrl = opt('api', process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const keysPath = resolve(opt('keys', resolve(here, '../.device-keys.json')));

if (!existsSync(keysPath)) {
  console.error(
    `Device keys not found at ${keysPath}. Run \`pnpm db:seed\` first (it writes them).`,
  );
  process.exit(1);
}
const keys = JSON.parse(readFileSync(keysPath, 'utf8')) as Record<string, string>;
const geo = buildDemoGeography();
const rand = mulberry32(Date.now() & 0xffff);
const pick = <T>(arr: readonly T[], r = rand()) =>
  arr[Math.min(arr.length - 1, Math.floor(r * arr.length))]!;
const weighted = <T>(items: [T, number][]): T => {
  let r = rand() * items.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[0]![0];
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const clients = new Map<string, DeviceClient>(
  DEMO_DEVICES.map((d) => [
    d.serial,
    new DeviceClient({ apiUrl, serial: d.serial, apiKey: keys[d.serial] ?? '' }),
  ]),
);
const track = DEMO_DEVICES.filter((d) => d.type === 'TRACK');
const crossing = DEMO_DEVICES.filter((d) => d.type === 'CROSSING');

// A few hotspot stretches so the risk map shows believable clustering.
const HOTSPOTS = [3200, 8800, 12100, 16600, 21500];

const CLASS_SOURCES: Record<DefectClass, ('IMAGE' | 'VIBRATION' | 'ACOUSTIC')[]> = {
  MISSING_FASTENER: ['IMAGE', 'VIBRATION'],
  BROKEN_FASTENER: ['IMAGE', 'VIBRATION'],
  DAMAGED_SLEEPER: ['IMAGE', 'VIBRATION'],
  RAIL_SURFACE_DEFECT: ['IMAGE', 'ACOUSTIC'],
  RAIL_JOINT_PROBLEM: ['VIBRATION', 'ACOUSTIC'],
  BALLAST_DEFICIENCY: ['IMAGE'],
  VEGETATION: ['IMAGE'],
  GEOMETRY_IRREGULARITY: ['VIBRATION'],
};
const CLASSES = Object.keys(CLASS_SOURCES) as DefectClass[];

function makeDetection(
  at: Date,
  withImage?: string,
): {
  id: string;
  detectedAt: string;
  lat: number;
  lon: number;
  defectClass: DefectClass;
  severity: Severity;
  confidence: number;
  sources: ('IMAGE' | 'VIBRATION' | 'ACOUSTIC')[];
  fusionLevel: 'HIGH' | 'REVIEW';
  imageKey?: string;
  bbox?: [number, number, number, number];
} {
  const hot = rand() < 0.65;
  const ch = hot ? Math.max(0, pick(HOTSPOTS) + (rand() - 0.5) * 900) : rand() * (geo.lengthM - 10);
  const [lon, lat] = pointAlong(geo.line, ch) as LonLat;
  const defectClass = pick(CLASSES);
  const severity = weighted<Severity>([
    ['MINOR', 55],
    ['MODERATE', 33],
    ['SEVERE', 12],
  ]);
  const confidence = Number(Math.min(0.99, 0.55 + rand() * 0.44).toFixed(3));
  const sources = CLASS_SOURCES[defectClass];
  return {
    id: randomUUID(),
    detectedAt: at.toISOString(),
    lat: lat + (rand() - 0.5) * 0.00006, // ~3 m of GNSS jitter
    lon: lon + (rand() - 0.5) * 0.00006,
    defectClass,
    severity,
    confidence,
    sources,
    fusionLevel: sources.length > 1 && confidence > 0.8 ? ('HIGH' as const) : ('REVIEW' as const),
    ...(withImage ? { imageKey: withImage } : {}),
  };
}

const OBJECTS: [CrossingObjectClass, number][] = [
  ['CAR', 22],
  ['MOTORCYCLE', 28],
  ['RICKSHAW', 14],
  ['CART', 8],
  ['TRACTOR', 5],
  ['PERSON', 15],
  ['LIVESTOCK', 6],
  ['OTHER', 2],
];
const hourWeight = (h: number) =>
  h >= 7 && h <= 9
    ? 3
    : h >= 16 && h <= 19
      ? 3.5
      : h >= 10 && h <= 15
        ? 1.5
        : h >= 5 && h <= 22
          ? 1
          : 0.15;

function makeCrossingEvent(at: Date) {
  const train = rand() < 0.18;
  const objectClass = weighted(OBJECTS);
  return {
    id: randomUUID(),
    occurredAt: at.toISOString(),
    objectClass,
    trainApproaching: train,
    dwellSeconds: Number((2 + rand() * (objectClass === 'LIVESTOCK' ? 80 : 30)).toFixed(1)),
    warningTriggered: train, // lights + siren fire when something is in the danger zone and a train approaches
    confidence: Number((0.6 + rand() * 0.39).toFixed(3)),
  };
}

const batches = <T>(arr: T[], n: number) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function heartbeat(serial: string, at = new Date(), queued = 0) {
  const hour = (at.getUTCHours() + 5) % 24; // PKT
  const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const isCrossing = serial.includes('XNG');
  const r = await clients.get(serial)!.post('/v1/ingest/heartbeat', {
    deviceTime: at.toISOString(),
    firmwareVersion: '0.1.0-demo',
    modelVersion: '0.1.0-demo',
    batteryPct: Number(
      Math.max(12, Math.min(100, 55 + 35 * sun - 10 + (rand() - 0.5) * 4)).toFixed(1),
    ),
    solarW: isCrossing ? Number((sun * (60 + rand() * 20)).toFixed(1)) : undefined,
    temperatureC: Number((24 + 14 * sun + rand() * 3).toFixed(1)),
    storagePct: Number((20 + rand() * 6).toFixed(1)),
    network: 'LTE_4G',
    queuedRecords: queued,
  });
  if (r.status !== 200) log(`heartbeat ${serial} -> ${r.status}`, r.body);
}

async function sendDetections(serial: string, items: ReturnType<typeof makeDetection>[]) {
  let totals = { accepted: 0, duplicates: 0, rejected: 0 };
  for (const b of batches(items, 100)) {
    const r = await clients
      .get(serial)!
      .post<{ accepted: number; duplicates: number; rejected: unknown[] }>(
        '/v1/ingest/detections',
        { items: b },
      );
    if (r.status !== 200) {
      log(`detections ${serial} -> ${r.status}`, JSON.stringify(r.body).slice(0, 200));
      continue;
    }
    totals = {
      accepted: totals.accepted + r.body.accepted,
      duplicates: totals.duplicates + r.body.duplicates,
      rejected: totals.rejected + r.body.rejected.length,
    };
  }
  return totals;
}

async function sendCrossingEvents(serial: string, items: ReturnType<typeof makeCrossingEvent>[]) {
  let accepted = 0;
  for (const b of batches(items, 200)) {
    const r = await clients
      .get(serial)!
      .post<{ accepted: number }>('/v1/ingest/crossing-events', { items: b });
    if (r.status === 200) accepted += r.body.accepted;
    else log(`crossing-events ${serial} -> ${r.status}`, JSON.stringify(r.body).slice(0, 200));
  }
  return accepted;
}

async function detectionsWithImages(serial: string, at: Date[]) {
  const c = clients.get(serial)!;
  const out = [];
  for (const t of at) {
    const probe = makeDetection(t);
    const up =
      probe.severity !== 'MINOR' ? await c.uploadImage(Math.floor(rand() * 1e6)) : undefined;
    out.push(up ? { ...probe, imageKey: up.key, bbox: up.bbox } : probe);
  }
  return out;
}

async function backfill(days: number) {
  log(`Backfilling ${days} days against ${apiUrl} (DEMO DATA)`);
  const now = Date.now();
  for (const d of track) {
    const times = Array.from(
      { length: Math.round(days * 3.5) },
      () => new Date(now - rand() * days * 86_400_000),
    );
    const items = await detectionsWithImages(d.serial, times);
    log(d.serial, 'detections', await sendDetections(d.serial, items));
    // one run per ~2 days
    for (let k = 0; k < days; k += 2) {
      const start = new Date(now - k * 86_400_000 - 6 * 3_600_000);
      await clients.get(d.serial)!.post('/v1/ingest/runs', {
        id: randomUUID(),
        startedAt: start.toISOString(),
        endedAt: new Date(start.getTime() + 50 * 60_000).toISOString(),
        distanceKm: Number((geo.lengthM / 1000).toFixed(2)),
        speedAvgKmh: 29.6,
        samplesCount: 90_000,
      });
    }
  }
  for (const d of crossing) {
    const evs = [];
    for (let day = 0; day < Math.min(days, 30); day++) {
      for (let h = 0; h < 24; h++) {
        const n = Math.round(hourWeight((h + 5) % 24) * (1 + rand() * 2.2));
        for (let i = 0; i < n; i++)
          evs.push(
            makeCrossingEvent(
              new Date(
                now - day * 86_400_000 - (23 - h) * 3_600_000 + rand() * 3_600_000 - 3_600_000,
              ),
            ),
          );
      }
    }
    log(
      d.serial,
      'crossing events',
      await sendCrossingEvents(
        d.serial,
        evs.filter((e) => new Date(e.occurredAt).getTime() < now),
      ),
    );
  }
  // heartbeat history so charts and uptime have data (server stamps "now"; recent beats only)
  for (const d of DEMO_DEVICES) await heartbeat(d.serial);
  log('Backfill done. Risk scores are recalculated by the worker (or in-process without Redis).');
}

async function offlineTest() {
  const serial = track[0]!.serial;
  const items = Array.from({ length: 5 }, () => makeDetection(new Date(Date.now() - 60_000)));
  const first = await sendDetections(serial, items);
  const again = await sendDetections(serial, items); // "device lost signal and resent"
  log('first send ', first);
  log('resend     ', again);
  const ok = first.accepted === 5 && again.accepted === 0 && again.duplicates === 5;
  console.log(
    ok
      ? 'PASS: resend was fully de-duplicated (idempotent ingestion).'
      : 'FAIL: idempotency check did not hold.',
  );
  process.exit(ok ? 0 : 1);
}

async function live() {
  log(`Live simulation against ${apiUrl} (DEMO DATA). Ctrl+C to stop.`);
  const outbox = new Map<string, ReturnType<typeof makeDetection>[]>();
  let tick = 0;
  let offlineUntil = 0;
  const offlineSerial = track[1]!.serial;
  for (;;) {
    tick++;
    const now = new Date();
    const goingOffline = Date.now() < offlineUntil;
    for (const d of DEMO_DEVICES) {
      if (d.serial === offlineSerial && goingOffline) continue; // no heartbeat while "offline"
      await heartbeat(d.serial, now, outbox.get(d.serial)?.length ?? 0);
    }
    for (const d of track) {
      const n = rand() < 0.5 ? 1 : rand() < 0.5 ? 0 : 2;
      const items = await detectionsWithImages(
        d.serial,
        Array.from({ length: n }, () => new Date()),
      );
      if (d.serial === offlineSerial && goingOffline) {
        outbox.set(d.serial, [...(outbox.get(d.serial) ?? []), ...items]); // store and forward
        continue;
      }
      const backlog = outbox.get(d.serial);
      if (backlog?.length) {
        const r = await sendDetections(d.serial, backlog);
        const dup = await sendDetections(d.serial, backlog.slice(0, 3)); // resend some on purpose
        log(`${d.serial} back online: flushed ${backlog.length}`, r, 'resend-check', dup);
        outbox.delete(d.serial);
      }
      if (items.length) log(d.serial, 'detections', await sendDetections(d.serial, items));
    }
    for (const d of crossing) {
      const n = Math.round(hourWeight((now.getUTCHours() + 5) % 24) * rand() * 1.5);
      if (n > 0)
        log(
          d.serial,
          'crossing events',
          await sendCrossingEvents(
            d.serial,
            Array.from({ length: n }, () => makeCrossingEvent(new Date())),
          ),
        );
    }
    if (tick % 30 === 0) {
      offlineUntil = Date.now() + 90_000;
      log(`${offlineSerial} simulating signal loss for 90 s`);
    }
    await sleep(10_000);
  }
}

if (cmd === 'backfill') await backfill(Number(opt('days', '45')));
else if (cmd === 'offline-test') await offlineTest();
else await live();
