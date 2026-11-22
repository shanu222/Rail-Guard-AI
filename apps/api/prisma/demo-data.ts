/**
 * Pure (database-free) generator for the DEMO division.
 *
 * !! Everything here is ILLUSTRATIVE DEMO DATA. The track line is a plausible curve drawn near
 * !! Rawalpindi, not a survey of any Pakistan Railways asset, and must never be presented as real.
 */
import {
  buildSegments,
  lineLengthM,
  pointAlong,
  type LonLat,
  type SegmentDraft,
} from '@railguard/shared';

export const DEMO_DIVISION = { name: 'Rawalpindi Division (DEMO)', code: 'RWP-DEMO' } as const;
export const DEMO_SECTION = {
  name: 'Rawalpindi - Taxila Demo Section',
  fromStation: 'Rawalpindi (demo)',
  toStation: 'Taxila (demo)',
} as const;

/** Rough waypoints [lon, lat] running north-west out of Rawalpindi; smoothed below. */
const WAYPOINTS: LonLat[] = [
  [73.048, 33.601],
  [73.02, 33.612],
  [72.995, 33.625],
  [72.975, 33.648],
  [72.958, 33.668],
  [72.94, 33.682],
  [72.915, 33.7],
  [72.89, 33.708],
  [72.868, 33.722],
  [72.845, 33.738],
];

/** Uniform Catmull-Rom spline through the waypoints (gives realistic gentle curves). */
function smooth(pts: LonLat[], samples = 30): LonLat[] {
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  const out: LonLat[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (k: 0 | 1) =>
        0.5 *
        (2 * p1[k] +
          (-p0[k] + p2[k]) * t +
          (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
          (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Deterministic PRNG so the seed is reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface DemoSegment extends SegmentDraft {
  hasBridge: boolean;
  heatExposure: number;
  floodExposure: number;
  /** index into DEMO_CROSSINGS, or null */
  nearCrossingIdx: number | null;
}

export interface DemoCrossing {
  name: string;
  chainageM: number;
  point: LonLat;
  /** Danger zone polygon in image pixels (1280x720 frame) */
  dangerZone: [number, number][];
}

const CROSSING_CHAINAGES = [6200, 13800, 20100];
const BRIDGES: [number, number][] = [
  [9000, 9200],
  [16500, 16600],
];
const LOW_LYING: [number, number][] = [
  [11000, 12500],
  [18000, 19000],
];
const NEAR_CROSSING_M = 300;

export function buildDemoGeography() {
  const line = smooth(WAYPOINTS);
  const lengthM = lineLengthM(line);
  const rand = mulberry32(1584); // SPARK-2026-1584

  const crossings: DemoCrossing[] = CROSSING_CHAINAGES.map((ch, i) => ({
    name: `Demo Level Crossing ${i + 1}`,
    chainageM: ch,
    point: pointAlong(line, ch),
    dangerZone: [
      [300, 720],
      [980, 720],
      [820, 380],
      [460, 380],
    ],
  }));

  const segments: DemoSegment[] = buildSegments(line, 100).map((s) => {
    const mid = (s.chainageStartM + s.chainageEndM) / 2;
    const hasBridge = BRIDGES.some(([a, b]) => mid >= a && mid <= b);
    const low = LOW_LYING.some(([a, b]) => mid >= a && mid <= b);
    const heat = clamp01(0.55 + 0.25 * Math.sin(mid / 2600) + (rand() - 0.5) * 0.2);
    const flood = clamp01(low ? 0.7 + rand() * 0.2 : 0.05 + rand() * 0.15);
    const nearIdx = crossings.findIndex((c) => Math.abs(c.chainageM - mid) <= NEAR_CROSSING_M);
    return {
      ...s,
      hasBridge,
      heatExposure: Number(heat.toFixed(3)),
      floodExposure: Number(flood.toFixed(3)),
      nearCrossingIdx: nearIdx >= 0 ? nearIdx : null,
    };
  });

  const weather = Array.from({ length: 7 }, (_, d) => ({
    daysAgo: 6 - d,
    maxTempC: Number((38 + rand() * 8).toFixed(1)),
    rainfallMm: d === 4 ? Number((20 + rand() * 25).toFixed(1)) : Number((rand() * 3).toFixed(1)),
    floodFlag: false,
  }));

  return { line, lengthM, crossings, segments, weather };
}

export const DEMO_DEVICES = [
  { type: 'TRACK', serial: 'RG-TRK-DEMO-01', name: 'Demo Track Unit 1' },
  { type: 'TRACK', serial: 'RG-TRK-DEMO-02', name: 'Demo Track Unit 2' },
  { type: 'CROSSING', serial: 'RG-XNG-DEMO-01', name: 'Demo Crossing Unit 1', crossingIdx: 0 },
  { type: 'CROSSING', serial: 'RG-XNG-DEMO-02', name: 'Demo Crossing Unit 2', crossingIdx: 1 },
  { type: 'CROSSING', serial: 'RG-XNG-DEMO-03', name: 'Demo Crossing Unit 3', crossingIdx: 2 },
] as const;

export const DEMO_USERS = [
  { email: 'admin@demo.railguard.example', name: 'Demo Admin (RTL)', role: 'ADMIN', scoped: false },
  {
    email: 'engineer@demo.railguard.example',
    name: 'Demo Divisional Engineer',
    role: 'DIVISIONAL_ENGINEER',
    scoped: true,
  },
  {
    email: 'inspector@demo.railguard.example',
    name: 'Demo Inspector',
    role: 'INSPECTOR',
    scoped: true,
  },
  {
    email: 'viewer@demo.railguard.example',
    name: 'Demo Viewer (Evaluator)',
    role: 'VIEWER',
    scoped: true,
  },
] as const;
