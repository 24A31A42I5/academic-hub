/**
 * Tunable parameters for the deterministic comparison engine.
 * These are INITIAL values, not experimentally validated optima.
 * Change them here only; nothing else hard-codes weights or thresholds.
 */
import type { FeatureName } from "./schema.ts";

/** Group weights (sum = 100). Each group spreads its weight over its features. */
export const WEIGHT_GROUPS: Record<string, { weight: number; features: Partial<Record<FeatureName | "characters", number>> }> = {
  slant: { weight: 15, features: { slant: 1 } },
  stroke: { weight: 10, features: { stroke_weight: 1 } },
  letter_spacing: { weight: 10, features: { letter_spacing: 1 } },
  word_spacing: { weight: 10, features: { word_spacing: 1 } },
  baseline: { weight: 10, features: { baseline: 0.7, line_direction: 0.3 } },
  proportion: { weight: 10, features: { letter_height: 0.5, ascender_ratio: 0.5 } },
  style: { weight: 5, features: { writing_style: 0.6, connectivity: 0.4 } },
  characters: { weight: 25, features: { characters: 1 } },
  other: { weight: 5, features: { letter_roundness: 0.6, loop_size: 0.4 } },
};

/** Features whose confidence is below this are treated as unobserved. */
export const MIN_FEATURE_CONFIDENCE = 0.4;
/** Extractions below this overall confidence cannot produce a verdict. */
export const MIN_EXTRACTION_CONFIDENCE = 0.5;
/** Fraction of total weight that must be observable on both sides. */
export const MIN_WEIGHT_COVERAGE = 0.5;

export type SampleAggregation = "mean" | "median" | "trimmed_mean" | "max";
/** Trimmed mean drops the single best sample when >= 4 exist, so one lucky sample can't decide. */
export const SAMPLE_AGGREGATION: SampleAggregation = "trimmed_mean";

/** Pages: existing 60% average + 40% minimum rule, applied to VALID pages only. */
export const PAGE_AVG_WEIGHT = 0.6;
export const PAGE_MIN_WEIGHT = 0.4;

export const CONSISTENCY_THRESHOLDS = { HIGH: 80, MEDIUM: 60 };

export const MIN_ENROLLMENT_SAMPLES = 3;
export const MAX_ENROLLMENT_SAMPLES = 5;

/** Number of independent AI passes; a feature needs majority agreement or becomes "unknown". */
export const EXTRACTION_PASSES = 3;

/** Partial credit between character forms that are visually close. */
export const CHARACTER_FORM_SIMILARITY: Record<string, Record<string, number>> = {
  rounded: { looped: 0.5, closed: 0.5, simple: 0.4 },
  angular: { simple: 0.4 },
  looped: { rounded: 0.5, complex: 0.5 },
  open: { simple: 0.5 },
  closed: { rounded: 0.5 },
  simple: { rounded: 0.4, angular: 0.4, open: 0.5 },
  complex: { looped: 0.5 },
};

export const LINE_DIRECTION_SIMILARITY: Record<string, Record<string, number>> = {
  level: { rising: 0.4, descending: 0.4 },
  rising: { level: 0.4 },
  descending: { level: 0.4 },
  irregular: {},
};
