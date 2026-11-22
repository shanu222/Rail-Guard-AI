/**
 * Load / remove the DEMO dataset from the Admin screen (no command line needed).
 *
 * !! Everything created here is ILLUSTRATIVE DEMO DATA, flagged is_demo / "(DEMO)", and must never be
 * !! presented as real Pakistan Railways results. Removing it deletes only demo-flagged records.
 */
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_RISK_CONFIG,
  DEFECT_CLASSES,
  CROSSING_OBJECT_CLASSES,
  toWktLineString,
  toWktPoint,
} from '@railguard/shared';
import { prisma } from '../db';
import { recalculateDivision } from '../risk/run';
import {
  buildDemoGeography,
  DEMO_DEVICES,
  DEMO_DIVISION,
  DEMO_SECTION,
  mulberry32,
} from '../../prisma/demo-data';

const DAY = 86_400_000;
const DEMO_EMAIL = '@demo.railguard.example';

export async function demoStatus() {
  const [divisions, devices, detections, events] = await Promise.all([
    prisma.division.count({ where: { code: DEMO_DIVISION.code } }),
    prisma.device.count({ where: { isDemo: true } }),
    prisma.detection.count({ where: { device: { isDemo: true } } }),
    prisma.crossingEvent.count({ where: { device: { isDemo: true } } }),
  ]);
  return { present: divisions + devices > 0, divisions, devices, detections, events };
}

/** Remove every demo-flagged record. Real divisions, devices and users are never touched. */
export async function clearDemo() {
  const before = await demoStatus();
  await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_EMAIL } } });
  // division cascades: sections, segments, crossings, devices -> detections, events, runs, heartbeats,
  // risk scores, work orders, reports
  await prisma.division.deleteMany({ where: { code: DEMO_DIVISION.code } });
  await prisma.device.deleteMany({ where: { isDemo: true } });
  await prisma.detection.deleteMany({ where: { isDemo: true } });
  await prisma.crossingEvent.deleteMany({ where: { isDemo: true } });
  await prisma.weatherInput.deleteMany({ where: { isDemo: true } });
  await prisma.modelVersion.deleteMany({ where: { isDemo: true, type: { not: 'RISK_ENGINE' } } });
  await prisma.modelVersion.updateMany({ where: { isDemo: true }, data: { isDemo: false } });
  await prisma.setting.upsert({
    where: { key: 'demo_mode' },
    update: { value: false },
    create: { key: 'demo_mode', value: false },
  });
  return { removed: before, now: await demoStatus() };
}

/** Create the demo division with 45 days of simulated history. Replaces any previous demo data. */
export async function loadDemo(opts: { days?: number } = {}) {
  const days = opts.days ?? 45;
  await clearDemo();
  const geo = buildDemoGeography();
  const rand = mulberry32(Date.now() & 0xffffffff);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;
  const now = Date.now();

  const division = await prisma.division.create({ data: { ...DEMO_DIVISION } });

  // devices (keys are random and never shown: demo devices do not call the API)
  const deviceIds: string[] = [];
  for (const d of DEMO_DEVICES) {
    const secret = randomBytes(24).toString('hex');
    const created = await prisma.device.create({
      data: {
        type: d.type,
        serial: d.serial,
        name: d.name,
        divisionId: division.id,
        firmwareVersion: '0.1.0-demo',
        modelVersion: '0.1.0-demo',
        status: 'ONLINE',
        apiKeyHash: createHash('sha256').update(secret).digest('hex'),
        apiKeyPrefix: randomBytes(4).toString('hex'),
        isDemo: true,
      },
    });
    deviceIds.push(created.id);
  }
  const trackIds = deviceIds.filter((_, i) => DEMO_DEVICES[i]!.type === 'TRACK');

  // section, crossings, segments
  const sectionId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO sections (id, division_id, name, from_station, to_station, length_km, geom)
    VALUES (${sectionId}::uuid, ${division.id}::uuid, ${DEMO_SECTION.name}, ${DEMO_SECTION.fromStation},
            ${DEMO_SECTION.toStation}, ${Number((geo.lengthM / 1000).toFixed(3))},
            ST_GeomFromText(${toWktLineString(geo.line)}, 4326))`;
  const crossings: { id: string; unitId: string | null }[] = [];
  for (const [i, c] of geo.crossings.entries()) {
    const id = randomUUID();
    const unitIdx = DEMO_DEVICES.findIndex((d) => 'crossingIdx' in d && d.crossingIdx === i);
    await prisma.$executeRaw`
      INSERT INTO crossings (id, division_id, name, geom, status, danger_zone, unit_id)
      VALUES (${id}::uuid, ${division.id}::uuid, ${c.name}, ST_GeomFromText(${toWktPoint(c.point)}, 4326),
              'ACTIVE'::"CrossingStatus", ${JSON.stringify(c.dangerZone)}::jsonb, ${unitIdx >= 0 ? deviceIds[unitIdx]! : null}::uuid)`;
    crossings.push({ id, unitId: unitIdx >= 0 ? deviceIds[unitIdx]! : null });
  }
  const segIds: string[] = [];
  for (let i = 0; i < geo.segments.length; i += 50) {
    await prisma.$transaction(
      geo.segments.slice(i, i + 50).map((s) => {
        const id = randomUUID();
        segIds.push(id);
        const near = s.nearCrossingIdx === null ? null : crossings[s.nearCrossingIdx]!.id;
        return prisma.$executeRaw`
          INSERT INTO segments (id, section_id, chainage_start_m, chainage_end_m, geom, is_curve,
                                has_bridge, near_crossing_id, heat_exposure, flood_exposure)
          VALUES (${id}::uuid, ${sectionId}::uuid, ${s.chainageStartM}, ${s.chainageEndM},
                  ST_GeomFromText(${toWktLineString(s.coords)}, 4326), ${s.isCurve}, ${s.hasBridge},
                  ${near}::uuid, ${s.heatExposure}, ${s.floodExposure})`;
      }),
    );
  }

  // weather (last 7 days)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await prisma.weatherInput.createMany({
    data: geo.weather.map((w) => ({
      sectionId,
      date: new Date(today.getTime() - w.daysAgo * DAY),
      maxTempC: w.maxTempC,
      rainfallMm: w.rainfallMm,
      floodFlag: w.floodFlag,
      isDemo: true,
    })),
  });

  // inspection runs: one per track unit every second day
  const runs: { id: string; deviceId: string; startedAt: Date; endedAt: Date }[] = [];
  for (let d = days; d >= 0; d -= 2)
    for (const deviceId of trackIds) {
      const startedAt = new Date(now - d * DAY - (8 + rand() * 4) * 3_600_000);
      const minutes = 35 + rand() * 25;
      runs.push({
        id: randomUUID(),
        deviceId,
        startedAt,
        endedAt: new Date(startedAt.getTime() + minutes * 60_000),
      });
    }
  await prisma.run.createMany({
    data: runs.map((r) => ({
      ...r,
      sectionId,
      distanceKm: Number((geo.lengthM / 1000).toFixed(2)),
      speedAvgKmh: Number((22 + rand() * 10).toFixed(1)),
      samplesCount: Math.floor(4000 + rand() * 3000),
    })),
  });

  // detections: clustered on a few "problem" stretches so the risk map has real structure
  const hot = Array.from({ length: 6 }, () => Math.floor(rand() * segIds.length));
  const sevs = ['MINOR', 'MODERATE', 'SEVERE'] as const;
  const srcSets = [
    ['IMAGE'],
    ['IMAGE', 'VIBRATION'],
    ['VIBRATION', 'ACOUSTIC'],
    ['IMAGE', 'ACOUSTIC'],
  ];
  const dets: string[] = [];
  for (const run of runs) {
    const n = Math.floor(rand() * 4) + 1;
    for (let k = 0; k < n; k++) {
      const segIdx =
        rand() < 0.65
          ? Math.min(segIds.length - 1, Math.max(0, pick(hot) + Math.floor((rand() - 0.5) * 6)))
          : Math.floor(rand() * segIds.length);
      const detectedAt = new Date(run.startedAt.getTime() + rand() * 30 * 60_000);
      const ageDays = (now - detectedAt.getTime()) / DAY;
      const r = rand();
      const review =
        ageDays < 5 ? 'PENDING' : r < 0.72 ? 'CONFIRMED' : r < 0.86 ? 'REJECTED' : 'PENDING';
      const reviewedAt =
        review === 'PENDING'
          ? null
          : new Date(detectedAt.getTime() + (2 + rand() * 46) * 3_600_000);
      const confidence = Number((0.55 + rand() * 0.43).toFixed(2));
      const sev = sevs[rand() < 0.5 ? 0 : rand() < 0.75 ? 1 : 2];
      const id = randomUUID();
      dets.push(id);
      await prisma.$executeRaw`
        INSERT INTO detections (id, run_id, device_id, segment_id, geom, chainage_m, detected_at, received_at,
          defect_class, severity, confidence, sources, fusion_level, review_status, reviewed_at,
          review_note, is_demo)
        SELECT ${id}::uuid, ${run.id}::uuid, ${run.deviceId}::uuid, s.id,
               ST_LineInterpolatePoint(s.geom, ${rand()}), s.chainage_start_m + ${Math.floor(rand() * 100)},
               ${detectedAt}, ${new Date(detectedAt.getTime() + 60_000 * (1 + rand() * 20))},
               ${pick(DEFECT_CLASSES)}::"DefectClass", ${sev}::"Severity", ${confidence},
               ${pick(srcSets)}::"DetectionSource"[], ${confidence > 0.8 ? 'HIGH' : 'REVIEW'}::"FusionLevel",
               ${review}::"ReviewStatus", ${reviewedAt}, ${review === 'PENDING' ? null : 'Demo review'}, true
        FROM segments s WHERE s.id = ${segIds[segIdx]!}::uuid`;
    }
  }

  // crossing events
  const events = [];
  for (let d = days; d >= 0; d--)
    for (const c of crossings) {
      if (!c.unitId) continue; // only crossings fitted with a (demo) unit produce events
      const unitId = c.unitId;
      const n = 3 + Math.floor(rand() * 6);
      for (let k = 0; k < n; k++) {
        const train = rand() < 0.4;
        events.push({
          id: randomUUID(),
          crossingId: c.id,
          deviceId: unitId,
          occurredAt: new Date(now - d * DAY - rand() * DAY),
          objectClass: pick(CROSSING_OBJECT_CLASSES),
          trainApproaching: train,
          dwellSeconds: Number((2 + rand() * 40).toFixed(1)),
          warningTriggered: train && rand() < 0.8,
          confidence: Number((0.6 + rand() * 0.38).toFixed(2)),
          isDemo: true,
        });
      }
    }
  await prisma.crossingEvent.createMany({ data: events });

  // heartbeats: hourly for the last 3 days; one crossing unit degraded
  const beats = [];
  for (const [i, deviceId] of deviceIds.entries()) {
    const crossing = DEMO_DEVICES[i]!.type === 'CROSSING';
    for (let h = 72; h >= 0; h--) {
      const t = new Date(now - h * 3_600_000);
      const hour = t.getUTCHours() + 5; // PKT
      const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
      beats.push({
        deviceId,
        receivedAt: t,
        batteryPct: Number((crossing ? 55 + 40 * sun + rand() * 5 : 70 + rand() * 25).toFixed(1)),
        solarW: crossing ? Number((sun * 60 + rand() * 4).toFixed(1)) : null,
        temperatureC: Number((30 + 12 * sun + rand() * 3).toFixed(1)),
        storagePct: Number((20 + rand() * 15).toFixed(1)),
        network: 'LTE_4G' as const,
        queuedRecords: 0,
      });
    }
  }
  await prisma.deviceHeartbeat.createMany({ data: beats });
  for (const [i, id] of deviceIds.entries())
    await prisma.device.update({
      where: { id },
      data: {
        lastSeenAt: new Date(now - (i === 4 ? 50 : 2) * 60_000),
        status: i === 4 ? 'DEGRADED' : 'ONLINE',
        batteryPct: i === 4 ? 31 : 84,
        solarW: DEMO_DEVICES[i]!.type === 'CROSSING' ? 42 : null,
        temperatureC: 38,
        storagePct: 27,
        network: 'LTE_4G',
      },
    });

  // demo model versions (kept clearly labelled) and settings
  for (const [type, version] of [
    ['TRACK_DEFECT', '0.1.0-demo'],
    ['CROSSING_VISION', '0.1.0-demo'],
  ] as const)
    await prisma.modelVersion.upsert({
      where: { type_version: { type, version } },
      update: { isDemo: true },
      create: {
        type,
        version,
        isActive: true,
        isDemo: true,
        metrics: { note: 'DEMO placeholder - not an evaluated model' },
      },
    });
  if (!(await prisma.setting.findUnique({ where: { key: 'risk_config' } })))
    await prisma.setting.create({
      data: { key: 'risk_config', value: DEFAULT_RISK_CONFIG as never },
    });
  await prisma.setting.upsert({
    where: { key: 'demo_mode' },
    update: { value: true },
    create: { key: 'demo_mode', value: true },
  });

  // risk scores, then a few work orders on the worst segments
  await recalculateDivision(division.id, { force: true });
  const worst = await prisma.$queryRaw<{ segment_id: string }[]>`
    SELECT l.segment_id FROM segment_latest_risk l JOIN segments s ON s.id = l.segment_id
    WHERE s.section_id = ${sectionId}::uuid ORDER BY l.score DESC, l.raw_value DESC LIMIT 4`;
  const statuses = ['OPEN', 'IN_PROGRESS', 'DONE', 'OPEN'] as const;
  for (const [i, w] of worst.entries())
    await prisma.workOrder.create({
      data: {
        segmentId: w.segment_id,
        priority: i === 0 ? 'CRITICAL' : 'HIGH',
        status: statuses[i]!,
        dueDate: new Date(now + (i + 2) * DAY),
        notes: 'DEMO work order - simulated data',
        closedAt: statuses[i] === 'DONE' ? new Date(now - DAY) : null,
      },
    });

  return {
    division: division.name,
    segments: segIds.length,
    devices: deviceIds.length,
    detections: dets.length,
    crossingEvents: events.length,
    runs: runs.length,
  };
}
