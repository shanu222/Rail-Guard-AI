/**
 * Pure (database-free) generator for the DEMO division.
 *
 * REAL: the track geometry, stations, level crossings and bridges are the actual Chaklala - Taxila
 *       stretch of Main Line ML-1, taken from OpenStreetMap (see ./osm-ml1-chaklala-taxila.ts).
 * DEMO: devices, detections, crossing events, reviews, risk scores and work orders are SIMULATED and
 *       must never be presented as Pakistan Railways results. Heat/flood exposure are rough estimates.
 */
import { buildSegments, lineLengthM, type LonLat, type SegmentDraft } from '@railguard/shared';
import { OSM_SECTION } from './osm-ml1-chaklala-taxila';

export const DEMO_DIVISION = { name: 'Rawalpindi Division (DEMO)', code: 'RWP-DEMO' } as const;
export const DEMO_SECTION = {
  name: `${OSM_SECTION.section.name} (DEMO data)`,
  fromStation: OSM_SECTION.section.fromStation,
  toStation: OSM_SECTION.section.toStation,
} as const;
export const DEMO_STATIONS = OSM_SECTION.stations;

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

/** Real bridges on the line (OSM bridge=* ways), as [startM, endM] chainage. */
const BRIDGES = OSM_SECTION.bridges as unknown as [number, number][];
const NEAR_CROSSING_M = 300;
/** Bridges usually cross nullahs/streams, so segments near them get a higher (estimated) flood exposure. */
const NEAR_BRIDGE_M = 400;

export function buildDemoGeography() {
  const line = OSM_SECTION.line.map((c) => [c[0], c[1]] as LonLat);
  const lengthM = lineLengthM(line);
  const rand = mulberry32(1584); // SPARK-2026-1584

  // every real level crossing on the line (OpenStreetMap railway=level_crossing)
  const crossings: DemoCrossing[] = OSM_SECTION.levelCrossings.map((lc) => ({
    name: `Level crossing km ${(lc.chainageM / 1000).toFixed(1)} (OSM ${lc.osmId})`,
    chainageM: lc.chainageM,
    point: [lc.lon, lc.lat] as LonLat,
    dangerZone: [
      [300, 720],
      [980, 720],
      [820, 380],
      [460, 380],
    ],
  }));

  const segments: DemoSegment[] = buildSegments(line, 100, 2).map((s) => {
    const mid = (s.chainageStartM + s.chainageEndM) / 2;
    const hasBridge = BRIDGES.some(([a, b]) => b >= s.chainageStartM && a <= s.chainageEndM);
    const nearBridge = BRIDGES.some(
      ([a, b]) => mid >= a - NEAR_BRIDGE_M && mid <= b + NEAR_BRIDGE_M,
    );
    // estimates (Potohar plateau: hot summers everywhere; flood risk where the line crosses water)
    const heat = clamp01(0.6 + (rand() - 0.5) * 0.15);
    const flood = clamp01(nearBridge ? 0.65 + rand() * 0.2 : 0.08 + rand() * 0.12);
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
  // demo units placed on three of the real level crossings (others have no unit yet)
  { type: 'CROSSING', serial: 'RG-XNG-DEMO-01', name: 'Demo Crossing Unit 1', crossingIdx: 2 },
  { type: 'CROSSING', serial: 'RG-XNG-DEMO-02', name: 'Demo Crossing Unit 2', crossingIdx: 8 },
  { type: 'CROSSING', serial: 'RG-XNG-DEMO-03', name: 'Demo Crossing Unit 3', crossingIdx: 11 },
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
