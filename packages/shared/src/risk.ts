import { z } from 'zod';

/** Risk-engine configuration (editable by Admin, stored in the `settings` table). */
export const RiskWeightsSchema = z.object({
  defect: z.number().min(0).max(1),
  trend: z.number().min(0).max(1),
  heat: z.number().min(0).max(1),
  flood: z.number().min(0).max(1),
  local: z.number().min(0).max(1),
});
export type RiskWeights = z.infer<typeof RiskWeightsSchema>;

export const RiskConfigSchema = z.object({
  weights: RiskWeightsSchema,
  /**
   * Upper bounds on `raw` for scores 1..4 (score 5 is anything above the last bound). When
   * `mode` is "quantile" the bounds are quantiles (0..1) of raw values within the division.
   */
  thresholds: z.object({
    mode: z.enum(['quantile', 'absolute']),
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  severityWeights: z.object({ MINOR: z.number(), MODERATE: z.number(), SEVERE: z.number() }),
  reviewMultipliers: z.object({
    CONFIRMED: z.number(),
    PENDING: z.number(),
    NEEDS_INFO: z.number(),
    REJECTED: z.number(),
  }),
  lookbackDays: z.number().int().positive(),
  halfLifeDays: z.number().positive(),
  heatTempThresholdC: z.number(),
  floodRainfall72hMm: z.number(),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  weights: { defect: 0.45, trend: 0.15, heat: 0.15, flood: 0.15, local: 0.1 },
  thresholds: { mode: 'quantile', bounds: [0.4, 0.7, 0.88, 0.96] },
  severityWeights: { MINOR: 1, MODERATE: 3, SEVERE: 6 },
  reviewMultipliers: { CONFIRMED: 1.5, PENDING: 1, NEEDS_INFO: 1, REJECTED: 0 },
  lookbackDays: 90,
  halfLifeDays: 30,
  heatTempThresholdC: 45,
  floodRainfall72hMm: 50,
};

/** Shape stored in risk_scores.components so the UI can explain every score. */
export const RiskComponentsSchema = z.object({
  defect: z.number(),
  trend: z.number(),
  heat: z.number(),
  flood: z.number(),
  local: z.number(),
  weights: RiskWeightsSchema,
  contributions: RiskWeightsSchema,
  detectionCount: z.number().int(),
});
export type RiskComponents = z.infer<typeof RiskComponentsSchema>;

export const RISK_COLORS = {
  1: '#2E9E5B',
  2: '#8CC63F',
  3: '#F2B01E',
  4: '#E8643A',
  5: '#D62839',
} as const;
export const RISK_LABELS = {
  1: 'Low',
  2: 'Guarded',
  3: 'Elevated',
  4: 'High',
  5: 'Critical',
} as const;
export const RISK_DISCLAIMER = 'Decision aid — confirm on site';
