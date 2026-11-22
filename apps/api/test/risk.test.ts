import { describe, expect, it } from 'vitest';
import { DEFAULT_RISK_CONFIG } from '@railguard/shared';
import {
  assignScores,
  defectComponent,
  floodComponent,
  heatComponent,
  localComponent,
  quantile,
  recencyDecay,
  scoreSegment,
  type DetectionInput,
  type SegmentInput,
} from '../src/risk/engine';

const cfg = DEFAULT_RISK_CONFIG;
const det = (o: Partial<DetectionInput> = {}): DetectionInput => ({
  severity: 'MODERATE',
  confidence: 1,
  reviewStatus: 'PENDING',
  ageDays: 0,
  ...o,
});
const seg = (o: Partial<SegmentInput> = {}): SegmentInput => ({
  segmentId: 's1',
  isCurve: false,
  hasBridge: false,
  nearCrossing: false,
  heatExposure: 0,
  floodExposure: 0,
  detections: [],
  ...o,
});
const dry = { maxTempC: 30, rainfall72hMm: 0, floodFlag: false };

describe('defect component', () => {
  it('halves every 30 days', () => {
    expect(recencyDecay(0, 30)).toBe(1);
    expect(recencyDecay(30, 30)).toBeCloseTo(0.5);
    expect(recencyDecay(60, 30)).toBeCloseTo(0.25);
  });

  it('weights severity x confidence', () => {
    expect(defectComponent([det({ severity: 'MINOR', confidence: 0.5 })], cfg)).toBeCloseTo(0.5);
    expect(defectComponent([det({ severity: 'SEVERE', confidence: 1 })], cfg)).toBeCloseTo(6);
  });

  it('counts CONFIRMED x1.5, PENDING x1 and REJECTED as 0', () => {
    const base = defectComponent([det({ reviewStatus: 'PENDING' })], cfg);
    expect(defectComponent([det({ reviewStatus: 'CONFIRMED' })], cfg)).toBeCloseTo(base * 1.5);
    expect(defectComponent([det({ reviewStatus: 'REJECTED' })], cfg)).toBe(0);
  });

  it('ignores detections older than the 90-day look-back', () => {
    expect(defectComponent([det({ ageDays: 91 })], cfg)).toBe(0);
    expect(defectComponent([det({ ageDays: 89 })], cfg)).toBeGreaterThan(0);
  });
});

describe('other components', () => {
  it('heat is full at >=45C forecast, half otherwise', () => {
    expect(heatComponent(0.8, { ...dry, maxTempC: 46 }, cfg)).toBeCloseTo(0.8);
    expect(heatComponent(0.8, { ...dry, maxTempC: 40 }, cfg)).toBeCloseTo(0.4);
    expect(heatComponent(0.8, { ...dry, maxTempC: null }, cfg)).toBeCloseTo(0.4);
  });
  it('flood is full with >=50 mm in 72 h or a flood flag, else 0.4x', () => {
    expect(floodComponent(1, { ...dry, rainfall72hMm: 50 }, cfg)).toBe(1);
    expect(floodComponent(1, { ...dry, floodFlag: true }, cfg)).toBe(1);
    expect(floodComponent(1, dry, cfg)).toBeCloseTo(0.4);
  });
  it('local = 0.3 curve + 0.4 bridge + 0.3 crossing', () => {
    expect(localComponent({ isCurve: true, hasBridge: true, nearCrossing: true })).toBeCloseTo(1);
    expect(localComponent({ isCurve: false, hasBridge: true, nearCrossing: false })).toBeCloseTo(
      0.4,
    );
  });
});

describe('trend component', () => {
  it('is positive when defects are rising and 0 when falling', () => {
    const rising = scoreSegment(seg({ detections: [det({ ageDays: 1 })] }), dry, cfg);
    expect(rising.components.trend).toBeGreaterThan(0);
    const falling = scoreSegment(seg({ detections: [det({ ageDays: 40 })] }), dry, cfg); // only existed 30+ days ago
    expect(falling.components.trend).toBe(0);
  });
});

describe('explainability', () => {
  it('raw equals the sum of the stored weighted contributions', () => {
    const r = scoreSegment(
      seg({
        isCurve: true,
        heatExposure: 0.7,
        floodExposure: 0.5,
        detections: [det({ severity: 'SEVERE', reviewStatus: 'CONFIRMED', ageDays: 3 })],
      }),
      { maxTempC: 47, rainfall72hMm: 60, floodFlag: false },
      cfg,
    );
    const c = r.components.contributions;
    expect(r.raw).toBeCloseTo(c.defect + c.trend + c.heat + c.flood + c.local, 10);
    expect(r.components.weights).toEqual(cfg.weights);
    expect(r.components.detectionCount).toBe(1);
  });
});

describe('score thresholds', () => {
  it('quantile mode spreads scores 1..5 within the division', () => {
    const raws = Array.from({ length: 100 }, (_, i) => i);
    const { scores } = assignScores(raws, cfg);
    expect(Math.min(...scores)).toBe(1);
    expect(Math.max(...scores)).toBe(5);
    expect(scores.filter((s) => s === 5).length).toBeLessThanOrEqual(6);
  });
  it('absolute mode uses the configured bounds', () => {
    const abs = {
      ...cfg,
      thresholds: {
        mode: 'absolute' as const,
        bounds: [1, 2, 3, 4] as [number, number, number, number],
      },
    };
    expect(assignScores([0.5, 1.5, 2.5, 3.5, 9], abs).scores).toEqual([1, 2, 3, 4, 5]);
  });
  it('an all-zero division scores everything 1', () => {
    expect(assignScores([0, 0, 0], cfg).scores).toEqual([1, 1, 1]);
  });
  it('quantile interpolates', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
  });
});
