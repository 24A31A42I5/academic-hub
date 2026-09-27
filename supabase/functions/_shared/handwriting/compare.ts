/**
 * Deterministic handwriting comparison engine. Pure functions only — no AI,
 * no I/O — so every score can be reproduced and unit-tested.
 */
import {
  CHARACTER_KEYS, NOMINAL_FEATURES, ORDINAL_FEATURES, UNKNOWN,
  type ExtractedProfile, type FeatureName,
} from "./schema.ts";
import {
  CHARACTER_FORM_SIMILARITY, CONSISTENCY_THRESHOLDS, LINE_DIRECTION_SIMILARITY,
  MIN_EXTRACTION_CONFIDENCE, MIN_FEATURE_CONFIDENCE, MIN_WEIGHT_COVERAGE,
  PAGE_AVG_WEIGHT, PAGE_MIN_WEIGHT, SAMPLE_AGGREGATION, WEIGHT_GROUPS,
  type SampleAggregation,
} from "./config.ts";

/** Map an ordinal value to [0,1] (e.g. slant left=0, upright=0.5, right=1 ≙ -1/0/+1). */
export function normalizeOrdinal(feature: keyof typeof ORDINAL_FEATURES, value: string | undefined): number | null {
  if (!value || value === UNKNOWN) return null;
  const scale = ORDINAL_FEATURES[feature] as readonly string[];
  const idx = scale.indexOf(value);
  if (idx < 0) return null;
  return scale.length === 1 ? 0 : idx / (scale.length - 1);
}

function observed(p: ExtractedProfile, f: FeatureName): string | null {
  const v = p.features[f];
  if (!v || v === UNKNOWN) return null;
  const c = p.feature_confidence[f];
  if (typeof c === "number" && c < MIN_FEATURE_CONFIDENCE) return null;
  return v;
}

/** Similarity in [0,1] for one feature, or null when not observable on both sides. */
export function featureSimilarity(a: ExtractedProfile, b: ExtractedProfile, f: FeatureName): number | null {
  const va = observed(a, f), vb = observed(b, f);
  if (va === null || vb === null) return null;
  if (f in ORDINAL_FEATURES) {
    const na = normalizeOrdinal(f as keyof typeof ORDINAL_FEATURES, va);
    const nb = normalizeOrdinal(f as keyof typeof ORDINAL_FEATURES, vb);
    if (na === null || nb === null) return null;
    return 1 - Math.abs(na - nb);
  }
  if (f in NOMINAL_FEATURES) {
    if (va === vb) return 1;
    return LINE_DIRECTION_SIMILARITY[va]?.[vb] ?? 0;
  }
  return null;
}

export function characterSimilarity(a: ExtractedProfile, b: ExtractedProfile): { score: number | null; compared: number } {
  let sum = 0, n = 0;
  for (const k of CHARACTER_KEYS) {
    const va = a.characters[k], vb = b.characters[k];
    if (!va || !vb || va === UNKNOWN || vb === UNKNOWN) continue;
    sum += va === vb ? 1 : (CHARACTER_FORM_SIMILARITY[va]?.[vb] ?? 0);
    n++;
  }
  // Need at least 2 comparable letters to count the group at all.
  return n >= 2 ? { score: sum / n, compared: n } : { score: null, compared: n };
}

export interface FeatureBreakdownItem {
  feature: string;
  group: string;
  weight: number;
  similarity: number | null;
  reference?: string;
  submission?: string;
}

export interface PairComparison {
  similarity: number | null;   // 0..100, null when insufficient evidence
  coverage: number;             // 0..1 fraction of total weight observable
  breakdown: FeatureBreakdownItem[];
}

/** Weighted similarity between two extracted profiles. Missing features are dropped and weights renormalized. */
export function comparePair(ref: ExtractedProfile, sub: ExtractedProfile): PairComparison {
  const total = Object.values(WEIGHT_GROUPS).reduce((s, g) => s + g.weight, 0);
  let usedWeight = 0, weighted = 0;
  const breakdown: FeatureBreakdownItem[] = [];

  for (const [group, def] of Object.entries(WEIGHT_GROUPS)) {
    const share = Object.values(def.features).reduce((s, v) => s + (v ?? 0), 0);
    for (const [feature, part] of Object.entries(def.features)) {
      const w = def.weight * ((part ?? 0) / share);
      let sim: number | null;
      if (feature === "characters") sim = characterSimilarity(ref, sub).score;
      else sim = featureSimilarity(ref, sub, feature as FeatureName);
      breakdown.push({
        feature, group, weight: Number(w.toFixed(2)), similarity: sim === null ? null : Number(sim.toFixed(3)),
        ...(feature !== "characters" ? { reference: ref.features[feature as FeatureName], submission: sub.features[feature as FeatureName] } : {}),
      });
      if (sim === null) continue;
      usedWeight += w;
      weighted += w * sim;
    }
  }
  const coverage = usedWeight / total;
  if (coverage < MIN_WEIGHT_COVERAGE || usedWeight === 0) return { similarity: null, coverage, breakdown };
  return { similarity: Math.round((weighted / usedWeight) * 1000) / 10, coverage, breakdown };
}

export function aggregate(values: number[], method: SampleAggregation = SAMPLE_AGGREGATION): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  switch (method) {
    case "mean": return mean(s);
    case "max": return s[s.length - 1];
    case "median": {
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case "trimmed_mean":
      return s.length >= 4 ? mean(s.slice(0, -1)) : mean(s);
  }
}

export type ConsistencyCategory = "high" | "medium" | "low";
export function categorize(score: number): ConsistencyCategory {
  if (score >= CONSISTENCY_THRESHOLDS.HIGH) return "high";
  if (score >= CONSISTENCY_THRESHOLDS.MEDIUM) return "medium";
  return "low";
}

export type PageStatus = "compared" | "invalid_quality" | "not_handwriting" | "low_confidence" | "insufficient_evidence" | "processing_error";

export interface PageResult {
  page: number;
  status: PageStatus;
  similarity: number | null;
  category: ConsistencyCategory | null;
  per_sample_scores: Array<{ sample_id: string; similarity: number | null; coverage: number }>;
  extraction_confidence: number | null;
  quality_status: string | null;
  coverage: number | null;
  breakdown?: FeatureBreakdownItem[];
  message?: string;
  // legacy fields kept so older UI keeps rendering
  is_handwritten: boolean;
  same_writer: boolean;
  confidence: "high" | "medium" | "low";
}

export interface EnrollmentSample { id: string; profile: ExtractedProfile }

/** Compare one page against every enrollment sample of the SAME student. */
export function comparePage(page: number, sub: ExtractedProfile, samples: EnrollmentSample[]): PageResult {
  const base = {
    page, per_sample_scores: [] as PageResult["per_sample_scores"],
    extraction_confidence: sub.overall_confidence, quality_status: sub.quality_status, coverage: null,
  };
  const conf = (c: number): PageResult["confidence"] => (c >= 0.75 ? "high" : c >= 0.5 ? "medium" : "low");

  if (!sub.is_handwritten || sub.quality_status === "not_handwriting") {
    return { ...base, status: "not_handwriting", similarity: null, category: null, is_handwritten: false, same_writer: false, confidence: "high", message: "Page does not appear to be handwritten." };
  }
  if (sub.quality_status !== "ok") {
    return { ...base, status: "invalid_quality", similarity: null, category: null, is_handwritten: true, same_writer: false, confidence: "low", message: "Image quality insufficient. Please recapture this page." };
  }
  if (sub.overall_confidence < MIN_EXTRACTION_CONFIDENCE) {
    return { ...base, status: "low_confidence", similarity: null, category: null, is_handwritten: true, same_writer: false, confidence: "low", message: "Handwriting features could not be read confidently. Please capture a clearer page." };
  }

  const per = samples.map((s) => {
    const r = comparePair(s.profile, sub);
    return { sample_id: s.id, similarity: r.similarity, coverage: Number(r.coverage.toFixed(2)), breakdown: r.breakdown };
  });
  const valid = per.filter((p) => p.similarity !== null) as Array<typeof per[number] & { similarity: number }>;
  const agg = aggregate(valid.map((v) => v.similarity));
  const perScores = per.map(({ breakdown: _b, ...rest }) => rest);

  if (agg === null) {
    return { ...base, per_sample_scores: perScores, status: "insufficient_evidence", similarity: null, category: null, is_handwritten: true, same_writer: false, confidence: "low", message: "Not enough comparable handwriting traits on this page." };
  }
  const score = Math.round(agg * 10) / 10;
  const category = categorize(score);
  // Representative breakdown = the median-scoring sample.
  const sorted = [...valid].sort((a, b) => a.similarity - b.similarity);
  const rep = sorted[Math.floor(sorted.length / 2)];
  return {
    ...base,
    per_sample_scores: perScores,
    coverage: Number((valid.reduce((s, v) => s + v.coverage, 0) / valid.length).toFixed(2)),
    status: "compared", similarity: score, category, breakdown: rep.breakdown,
    is_handwritten: true, same_writer: category === "high", confidence: conf(sub.overall_confidence),
  };
}

export interface AssignmentResult {
  similarity: number | null;
  category: ConsistencyCategory | null;
  valid_pages: number;
  invalid_pages: number[];
  confidence: number | null;
}

/** Assignment-level score from VALID pages only (60% mean + 40% min). */
export function aggregatePages(pages: PageResult[]): AssignmentResult {
  const valid = pages.filter((p) => p.status === "compared" && p.similarity !== null);
  const invalid = pages.filter((p) => p.status !== "compared").map((p) => p.page);
  if (valid.length === 0) return { similarity: null, category: null, valid_pages: 0, invalid_pages: invalid, confidence: null };
  const sims = valid.map((p) => p.similarity as number);
  const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
  const min = Math.min(...sims);
  const score = Math.round(avg * PAGE_AVG_WEIGHT + min * PAGE_MIN_WEIGHT);
  const confs = valid.map((p) => p.extraction_confidence ?? 0);
  const confidence = Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100);
  return { similarity: score, category: categorize(score), valid_pages: valid.length, invalid_pages: invalid, confidence };
}
