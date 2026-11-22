/**
 * Risk score engine - pure functions (no I/O) so every score can be reproduced and unit-tested.
 * Decision aid only: scores must always be confirmed on site.
 */
import type { RiskComponents, RiskConfig, Severity } from '@railguard/shared';

export interface DetectionInput {
  severity: Severity;
  confidence: number;
  reviewStatus: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'NEEDS_INFO';
  /** age in days at the time of computation */
  ageDays: number;
}

export interface SegmentInput {
  segmentId: string;
  isCurve: boolean;
  hasBridge: boolean;
  nearCrossing: boolean;
  heatExposure: number;
  floodExposure: number;
  detections: DetectionInput[];
}

export interface WeatherContext {
  /** forecast / latest max temperature for the segment's area, deg C */
  maxTempC: number | null;
  /** rainfall over the last 72 h, mm */
  rainfall72hMm: number;
  floodFlag: boolean;
}

export const recencyDecay = (ageDays: number, halfLifeDays: number) =>
  Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);

/**
 * Sum of severity x confidence x recency decay x review multiplier over detections inside the
 * look-back window. `asOfOffsetDays` shifts the evaluation point into the past (used for the
 * trend component): only detections that already existed then are counted, aged accordingly.
 */
export function defectComponent(
  dets: DetectionInput[],
  cfg: RiskConfig,
  asOfOffsetDays = 0,
): number {
  let sum = 0;
  for (const d of dets) {
    const age = d.ageDays - asOfOffsetDays;
    if (age < 0 || age > cfg.lookbackDays) continue;
    const mult = cfg.reviewMultipliers[d.reviewStatus];
    if (mult === 0) continue;
    sum +=
      cfg.severityWeights[d.severity] * d.confidence * recencyDecay(age, cfg.halfLifeDays) * mult;
  }
  return sum;
}

export function heatComponent(exposure: number, w: WeatherContext, cfg: RiskConfig) {
  return exposure * (w.maxTempC !== null && w.maxTempC >= cfg.heatTempThresholdC ? 1 : 0.5);
}

export function floodComponent(exposure: number, w: WeatherContext, cfg: RiskConfig) {
  return exposure * (w.rainfall72hMm >= cfg.floodRainfall72hMm || w.floodFlag ? 1 : 0.4);
}

export const localComponent = (s: Pick<SegmentInput, 'isCurve' | 'hasBridge' | 'nearCrossing'>) =>
  0.3 * Number(s.isCurve) + 0.4 * Number(s.hasBridge) + 0.3 * Number(s.nearCrossing);

export interface ScoredSegment {
  segmentId: string;
  raw: number;
  components: RiskComponents;
}

export function scoreSegment(s: SegmentInput, w: WeatherContext, cfg: RiskConfig): ScoredSegment {
  const defect = defectComponent(s.detections, cfg);
  const previous = defectComponent(s.detections, cfg, 30);
  const trend = Math.max(0, defect - previous);
  const heat = heatComponent(s.heatExposure, w, cfg);
  const flood = floodComponent(s.floodExposure, w, cfg);
  const local = localComponent(s);
  const wt = cfg.weights;
  const contributions = {
    defect: wt.defect * defect,
    trend: wt.trend * trend,
    heat: wt.heat * heat,
    flood: wt.flood * flood,
    local: wt.local * local,
  };
  const raw =
    contributions.defect +
    contributions.trend +
    contributions.heat +
    contributions.flood +
    contributions.local;
  return {
    segmentId: s.segmentId,
    raw,
    components: {
      defect,
      trend,
      heat,
      flood,
      local,
      weights: wt,
      contributions,
      detectionCount: s.detections.filter((d) => cfg.reviewMultipliers[d.reviewStatus] > 0).length,
    },
  };
}

/** Linear-interpolated quantile of an ascending-sorted array. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Convert raw values to 1..5 using configured thresholds (quantiles within the division, or absolute). */
export function assignScores(
  raws: number[],
  cfg: RiskConfig,
): { scores: number[]; cutoffs: number[] } {
  const sorted = [...raws].sort((a, b) => a - b);
  const cutoffs =
    cfg.thresholds.mode === 'quantile'
      ? cfg.thresholds.bounds.map((q) => quantile(sorted, q))
      : [...cfg.thresholds.bounds];
  const scores = raws.map((r) => 1 + cutoffs.filter((c) => r > c).length);
  return { scores, cutoffs };
}

export function scoreDivision(
  segments: SegmentInput[],
  weather: Map<string, WeatherContext>,
  cfg: RiskConfig,
  fallback: WeatherContext,
) {
  const scored = segments.map((s) => scoreSegment(s, weather.get(s.segmentId) ?? fallback, cfg));
  const { scores, cutoffs } = assignScores(
    scored.map((x) => x.raw),
    cfg,
  );
  return { results: scored.map((x, i) => ({ ...x, score: scores[i]! })), cutoffs };
}
