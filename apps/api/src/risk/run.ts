import { DEFAULT_RISK_CONFIG, RiskConfigSchema, type RiskConfig } from '@railguard/shared';
import { prisma, Prisma } from '../db';
import { publish } from '../lib/events';
import {
  scoreDivision,
  type DetectionInput,
  type SegmentInput,
  type WeatherContext,
} from './engine';

const DAY = 86_400_000;

export async function loadRiskConfig(): Promise<RiskConfig> {
  const row = await prisma.setting.findUnique({ where: { key: 'risk_config' } });
  const parsed = RiskConfigSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_RISK_CONFIG;
}

interface SegRow {
  id: string;
  section_id: string;
  is_curve: boolean;
  has_bridge: boolean;
  near: boolean;
  heat_exposure: number;
  flood_exposure: number;
}
interface DetRow {
  segment_id: string;
  severity: DetectionInput['severity'];
  confidence: number;
  review_status: DetectionInput['reviewStatus'];
  detected_at: Date;
}
interface WxRow {
  section_id: string | null;
  segment_id: string | null;
  date: Date;
  max_temp_c: number | null;
  rainfall_mm: number | null;
  flood_flag: boolean;
}

/** Compute (without storing) scores for every segment of a division. */
export async function computeDivision(divisionId: string, cfg: RiskConfig, now = new Date()) {
  const since = new Date(now.getTime() - (cfg.lookbackDays + 30) * DAY);
  const wxSince = new Date(now.getTime() - 3 * DAY);

  const [segs, dets, wx] = await Promise.all([
    prisma.$queryRaw<SegRow[]>`
      SELECT s.id, s.section_id, s.is_curve, s.has_bridge, (s.near_crossing_id IS NOT NULL) AS near,
             s.heat_exposure, s.flood_exposure
      FROM segments s JOIN sections sec ON sec.id = s.section_id
      WHERE sec.division_id = ${divisionId}::uuid`,
    prisma.$queryRaw<DetRow[]>`
      SELECT d.segment_id, d.severity::text AS severity, d.confidence, d.review_status::text AS review_status, d.detected_at
      FROM detections d
      JOIN segments s ON s.id = d.segment_id JOIN sections sec ON sec.id = s.section_id
      WHERE sec.division_id = ${divisionId}::uuid AND d.detected_at >= ${since} AND d.review_status <> 'REJECTED'
        AND NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.status = 'DONE' AND d.id = ANY(w.detection_ids))`, // closed => no longer "open"
    prisma.$queryRaw<WxRow[]>`
      SELECT w.section_id, w.segment_id, w.date, w.max_temp_c, w.rainfall_mm, w.flood_flag
      FROM weather_inputs w
      LEFT JOIN sections sec ON sec.id = w.section_id
      LEFT JOIN segments s ON s.id = w.segment_id
      LEFT JOIN sections sec2 ON sec2.id = s.section_id
      WHERE (sec.division_id = ${divisionId}::uuid OR sec2.division_id = ${divisionId}::uuid) AND w.date >= ${wxSince}`,
  ]);

  const bySeg = new Map<string, DetectionInput[]>();
  for (const d of dets) {
    const arr = bySeg.get(d.segment_id) ?? [];
    arr.push({
      severity: d.severity,
      confidence: d.confidence,
      reviewStatus: d.review_status,
      ageDays: (now.getTime() - d.detected_at.getTime()) / DAY,
    });
    bySeg.set(d.segment_id, arr);
  }

  const ctx = (rows: WxRow[]): WeatherContext => {
    const temps = rows.map((r) => r.max_temp_c).filter((t): t is number => t !== null);
    return {
      maxTempC: temps.length ? Math.max(...temps) : null,
      rainfall72hMm: rows.reduce((a, r) => a + (r.rainfall_mm ?? 0), 0),
      floodFlag: rows.some((r) => r.flood_flag),
    };
  };
  const sectionCtx = new Map<string, WeatherContext>();
  for (const sid of new Set(wx.map((r) => r.section_id).filter((x): x is string => !!x))) {
    sectionCtx.set(sid, ctx(wx.filter((r) => r.section_id === sid)));
  }
  const segCtx = new Map<string, WeatherContext>();
  for (const id of new Set(wx.map((r) => r.segment_id).filter((x): x is string => !!x))) {
    segCtx.set(id, ctx(wx.filter((r) => r.segment_id === id)));
  }

  const none: WeatherContext = { maxTempC: null, rainfall72hMm: 0, floodFlag: false };
  const weather = new Map<string, WeatherContext>();
  const inputs: SegmentInput[] = segs.map((s) => {
    weather.set(s.id, segCtx.get(s.id) ?? sectionCtx.get(s.section_id) ?? none);
    return {
      segmentId: s.id,
      isCurve: s.is_curve,
      hasBridge: s.has_bridge,
      nearCrossing: s.near,
      heatExposure: s.heat_exposure,
      floodExposure: s.flood_exposure,
      detections: bySeg.get(s.id) ?? [],
    };
  });
  return scoreDivision(inputs, weather, cfg, none);
}

/** Compute and store a new risk_scores row per segment (history is kept). */
export async function recalculateDivision(divisionId: string, opts: { force?: boolean } = {}) {
  const cfg = await loadRiskConfig();
  const { results } = await computeDivision(divisionId, cfg);
  const mv = await prisma.modelVersion.findFirst({
    where: { type: 'RISK_ENGINE', isActive: true },
  });
  const modelVersion = `risk-engine@${mv?.version ?? '1.0.0'}`;

  // Event-driven runs only store changes; nightly/forced runs store everything.
  let toStore = results;
  if (!opts.force) {
    const prev = await prisma.$queryRaw<{ segment_id: string; score: number; raw_value: number }[]>`
      SELECT l.segment_id, l.score, l.raw_value FROM segment_latest_risk l
      JOIN segments s ON s.id = l.segment_id JOIN sections sec ON sec.id = s.section_id
      WHERE sec.division_id = ${divisionId}::uuid`;
    const pm = new Map(prev.map((p) => [p.segment_id, p]));
    toStore = results.filter((r) => {
      const p = pm.get(r.segmentId);
      return !p || p.score !== r.score || Math.abs(p.raw_value - r.raw) > 1e-6;
    });
  }
  const computedAt = new Date();
  for (let i = 0; i < toStore.length; i += 500) {
    await prisma.riskScore.createMany({
      data: toStore.slice(i, i + 500).map((r) => ({
        segmentId: r.segmentId,
        computedAt,
        score: r.score,
        rawValue: r.raw,
        components: r.components as unknown as Prisma.InputJsonValue,
        modelVersion,
      })),
    });
  }
  await publish({
    type: 'risk.updated',
    divisionId,
    data: { stored: toStore.length, total: results.length },
  });
  return { stored: toStore.length, total: results.length };
}

/** Preview the effect of proposed weights/thresholds without storing anything. */
export async function previewConfig(divisionId: string, proposed: RiskConfig) {
  const current = await loadRiskConfig();
  const [a, b] = await Promise.all([
    computeDivision(divisionId, current),
    computeDivision(divisionId, proposed),
  ]);
  const before = new Map(a.results.map((r) => [r.segmentId, r]));
  const dist = (rs: typeof a.results) =>
    [1, 2, 3, 4, 5].map((n) => rs.filter((r) => r.score === n).length);
  const changes = b.results
    .map((r) => ({
      segmentId: r.segmentId,
      from: before.get(r.segmentId)!.score,
      to: r.score,
      raw: r.raw,
    }))
    .filter((c) => c.from !== c.to)
    .sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from));
  return {
    distributionBefore: dist(a.results),
    distributionAfter: dist(b.results),
    changedSegments: changes.length,
    totalSegments: b.results.length,
    topChanges: changes.slice(0, 25),
  };
}
