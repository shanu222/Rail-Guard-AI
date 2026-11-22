/**
 * Seeds ONE demo division. Safe to re-run (it replaces the demo division and demo users).
 *
 *   pnpm db:seed         # writes to DATABASE_URL (requires DEMO_MODE=true)
 *   pnpm db:seed:dry     # builds everything in memory and prints a summary; no database needed
 *
 * Detections, crossing events and risk scores are NOT seeded here: the simulator produces them
 * through the real ingestion API, and the risk engine computes scores from them.
 */
import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RISK_CONFIG, lineLengthM, toWktLineString, toWktPoint } from '@railguard/shared';
import {
  buildDemoGeography,
  DEMO_DEVICES,
  DEMO_DIVISION,
  DEMO_SECTION,
  DEMO_USERS,
} from './demo-data';

const dryRun = process.argv.includes('--dry-run');
const here = dirname(fileURLToPath(import.meta.url));

const geo = buildDemoGeography();

function summarise() {
  const s = geo.segments;
  const contiguous = s.every((seg, i) => i === 0 || seg.chainageStartM === s[i - 1]!.chainageEndM);
  console.log('--- demo geography ---');
  console.log(`line points      : ${geo.line.length}`);
  console.log(`section length   : ${(geo.lengthM / 1000).toFixed(2)} km`);
  console.log(`segments         : ${s.length} (contiguous: ${contiguous})`);
  console.log(`curve segments   : ${s.filter((x) => x.isCurve).length}`);
  console.log(`bridge segments  : ${s.filter((x) => x.hasBridge).length}`);
  console.log(`near-crossing    : ${s.filter((x) => x.nearCrossingIdx !== null).length}`);
  console.log(
    `crossings        : ${geo.crossings.map((c) => `${c.name}@${c.chainageM}m`).join(', ')}`,
  );
  console.log(`devices          : ${DEMO_DEVICES.length}`);
  console.log(`first segment len: ${lineLengthM(s[0]!.coords).toFixed(1)} m`);
  if (!contiguous) throw new Error('segments are not contiguous');
}

function newDeviceKey() {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('hex');
  return {
    prefix,
    plaintext: `rgk_${prefix}_${secret}`,
    hash: createHash('sha256').update(secret).digest('hex'),
  };
}

async function main() {
  summarise();
  if (dryRun) {
    console.log('\nDry run complete (nothing written).');
    return;
  }

  if (process.env.DEMO_MODE !== 'true') {
    throw new Error(
      'Refusing to seed demo data: set DEMO_MODE=true (never seed demo data into production).',
    );
  }
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('Set SEED_DEMO_PASSWORD (min 12 chars) in apps/api/.env');

  const { PrismaClient } = await import('@prisma/client');
  const argon2 = (await import('argon2')).default;
  const prisma = new PrismaClient();

  try {
    // 1. wipe previous demo data (division cascades to sections, segments, crossings, devices, ...)
    await prisma.user.deleteMany({ where: { email: { endsWith: '@demo.railguard.example' } } });
    await prisma.division.deleteMany({ where: { code: DEMO_DIVISION.code } });
    await prisma.modelVersion.deleteMany({ where: { isDemo: true } });

    // 2. division
    const division = await prisma.division.create({ data: { ...DEMO_DIVISION } });

    // 3. devices (API keys are generated here; plaintext goes to the simulator key file only)
    const deviceKeys: Record<string, string> = {};
    const deviceIds: string[] = [];
    for (const d of DEMO_DEVICES) {
      const key = newDeviceKey();
      const created = await prisma.device.create({
        data: {
          type: d.type,
          serial: d.serial,
          name: d.name,
          divisionId: division.id,
          firmwareVersion: '0.1.0-demo',
          modelVersion: '0.1.0-demo',
          status: 'OFFLINE',
          apiKeyHash: key.hash,
          apiKeyPrefix: key.prefix,
          isDemo: true,
        },
      });
      deviceKeys[d.serial] = key.plaintext;
      deviceIds.push(created.id);
    }

    // 4. section + crossings + segments (spatial columns => raw SQL)
    const sectionId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO sections (id, division_id, name, from_station, to_station, length_km, geom)
      VALUES (${sectionId}::uuid, ${division.id}::uuid, ${DEMO_SECTION.name}, ${DEMO_SECTION.fromStation},
              ${DEMO_SECTION.toStation}, ${Number((geo.lengthM / 1000).toFixed(3))},
              ST_GeomFromText(${toWktLineString(geo.line)}, 4326))`;

    const crossingIds: string[] = [];
    for (const [i, c] of geo.crossings.entries()) {
      const id = randomUUID();
      const unitIdx = DEMO_DEVICES.findIndex((d) => 'crossingIdx' in d && d.crossingIdx === i);
      await prisma.$executeRaw`
        INSERT INTO crossings (id, division_id, name, geom, status, danger_zone, unit_id)
        VALUES (${id}::uuid, ${division.id}::uuid, ${c.name}, ST_GeomFromText(${toWktPoint(c.point)}, 4326),
                'ACTIVE'::"CrossingStatus", ${JSON.stringify(c.dangerZone)}::jsonb, ${unitIdx >= 0 ? deviceIds[unitIdx]! : null}::uuid)`;
      crossingIds.push(id);
    }

    const BATCH = 50;
    for (let i = 0; i < geo.segments.length; i += BATCH) {
      await prisma.$transaction(
        geo.segments.slice(i, i + BATCH).map((s) => {
          const near = s.nearCrossingIdx === null ? null : crossingIds[s.nearCrossingIdx]!;
          return prisma.$executeRaw`
            INSERT INTO segments (id, section_id, chainage_start_m, chainage_end_m, geom, is_curve,
                                  has_bridge, near_crossing_id, heat_exposure, flood_exposure)
            VALUES (${randomUUID()}::uuid, ${sectionId}::uuid, ${s.chainageStartM}, ${s.chainageEndM},
                    ST_GeomFromText(${toWktLineString(s.coords)}, 4326), ${s.isCurve}, ${s.hasBridge},
                    ${near}::uuid, ${s.heatExposure}, ${s.floodExposure})`;
        }),
      );
    }

    // 5. weather for the last 7 days (section-level)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.weatherInput.createMany({
      data: geo.weather.map((w) => ({
        sectionId,
        date: new Date(today.getTime() - w.daysAgo * 86_400_000),
        maxTempC: w.maxTempC,
        rainfallMm: w.rainfallMm,
        floodFlag: w.floodFlag,
        isDemo: true,
      })),
    });

    // 6. users (inspector is assigned to the demo section)
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    for (const u of DEMO_USERS) {
      const user = await prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          role: u.role,
          divisionId: u.scoped ? division.id : null,
          passwordHash,
        },
      });
      if (u.role === 'INSPECTOR')
        await prisma.userSection.create({ data: { userId: user.id, sectionId } });
    }

    // 7. model versions + settings
    await prisma.modelVersion.createMany({
      data: [
        {
          type: 'TRACK_DEFECT',
          version: '0.1.0-demo',
          isActive: true,
          isDemo: true,
          metrics: { note: 'DEMO placeholder - not an evaluated model' },
        },
        {
          type: 'CROSSING_VISION',
          version: '0.1.0-demo',
          isActive: true,
          isDemo: true,
          metrics: { note: 'DEMO placeholder - not an evaluated model' },
        },
        {
          type: 'RISK_ENGINE',
          version: '1.0.0',
          isActive: true,
          isDemo: true,
          metrics: { note: 'Rule-based engine; weights in settings.risk_config' },
        },
      ],
    });
    const settings: Record<string, unknown> = {
      risk_config: DEFAULT_RISK_CONFIG,
      snapshot_retention_days: Number(process.env.SNAPSHOT_RETENTION_DAYS ?? 30),
      // Admin enters the manual-inspection baseline (minutes per km) on the Analytics page.
      inspection_baseline_min_per_km: null,
      demo_mode: true,
    };
    for (const [key, value] of Object.entries(settings)) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: value as never },
        create: { key, value: value as never },
      });
    }

    // 8. device keys for the simulator (gitignored; shown here once, hashes only in the DB)
    const keyFile = resolve(here, '../../../packages/simulator/.device-keys.json');
    mkdirSync(dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, JSON.stringify(deviceKeys, null, 2));

    console.log(`\nSeeded DEMO division "${division.name}" (${geo.segments.length} segments).`);
    console.log(`Demo users: ${DEMO_USERS.map((u) => u.email).join(', ')}`);
    console.log(`Device API keys written to ${keyFile}`);
    console.log('All data is DEMO data - never present it as real Pakistan Railways results.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
