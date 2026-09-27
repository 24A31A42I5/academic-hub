/**
 * v8 handwriting feature schema.
 *
 * The AI is only allowed to answer with these categorical values (or
 * "unknown"). Everything downstream is deterministic code.
 */
import { z } from "npm:zod@3.23.8";

export const SCHEMA_VERSION = "8.0-consistency";

export const UNKNOWN = "unknown" as const;

/** Ordinal features: value order matters, similarity = 1 - distance. */
export const ORDINAL_FEATURES = {
  slant: ["left", "upright", "right"],
  stroke_weight: ["thin", "medium", "thick"],
  letter_spacing: ["tight", "normal", "wide"],
  word_spacing: ["tight", "normal", "wide"],
  baseline: ["straight", "slightly_wavy", "wavy", "erratic"],
  letter_height: ["small", "medium", "large"],
  ascender_ratio: ["short", "moderate", "tall"],
  writing_style: ["print", "mixed", "cursive"],
  connectivity: ["disconnected", "partial", "connected"],
  letter_roundness: ["angular", "mixed", "rounded"],
  loop_size: ["none", "small", "large"],
} as const;

/** Nominal features: no order, exact match or partial-credit table. */
export const NOMINAL_FEATURES = {
  line_direction: ["level", "rising", "descending", "irregular"],
} as const;

export const CHARACTER_KEYS = ["a", "d", "e", "g", "r", "s", "t", "y"] as const;
export const CHARACTER_FORMS = ["rounded", "angular", "looped", "open", "closed", "simple", "complex"] as const;

export type OrdinalFeature = keyof typeof ORDINAL_FEATURES;
export type NominalFeature = keyof typeof NOMINAL_FEATURES;
export type FeatureName = OrdinalFeature | NominalFeature;
export type CharacterKey = typeof CHARACTER_KEYS[number];

export const QUALITY_STATUSES = ["ok", "insufficient_quality", "insufficient_handwriting", "not_handwriting"] as const;
export type QualityStatus = typeof QUALITY_STATUSES[number];

const enumOrUnknown = (values: readonly string[]) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v),
    z.union([z.enum(values as [string, ...string[]]), z.literal(UNKNOWN), z.null()]),
  ).transform((v) => (v === null ? UNKNOWN : v));

const conf = z.preprocess(
  (v) => (typeof v === "string" ? Number(v) : v),
  z.number().min(0).max(1),
).catch(0);

const featureShape: Record<string, z.ZodTypeAny> = {};
for (const [k, vals] of Object.entries(ORDINAL_FEATURES)) featureShape[k] = enumOrUnknown(vals).catch(UNKNOWN);
for (const [k, vals] of Object.entries(NOMINAL_FEATURES)) featureShape[k] = enumOrUnknown(vals).catch(UNKNOWN);

const charShape: Record<string, z.ZodTypeAny> = {};
for (const c of CHARACTER_KEYS) charShape[c] = enumOrUnknown(CHARACTER_FORMS).catch(UNKNOWN);

const confShape: Record<string, z.ZodTypeAny> = {};
for (const k of Object.keys(featureShape)) confShape[k] = conf.optional();

/** Raw AI output schema. Unknown values are coerced to "unknown", never guessed. */
export const RawExtractionSchema = z.object({
  quality_status: z.enum(QUALITY_STATUSES).catch("insufficient_quality"),
  is_handwritten: z.boolean(),
  features: z.object(featureShape),
  characters: z.object(charShape).partial().default({}),
  feature_confidence: z.object(confShape).partial().default({}),
  overall_confidence: conf,
});

export type FeatureValues = Record<FeatureName, string>;
export type CharacterValues = Partial<Record<CharacterKey, string>>;

export interface ExtractedProfile {
  schema_version: string;
  quality_status: QualityStatus;
  is_handwritten: boolean;
  features: FeatureValues;
  characters: CharacterValues;
  feature_confidence: Partial<Record<FeatureName, number>>;
  overall_confidence: number;
}

export function parseExtraction(raw: unknown): { ok: true; profile: ExtractedProfile } | { ok: false; error: string } {
  const res = RawExtractionSchema.safeParse(raw);
  if (!res.success) return { ok: false, error: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const d = res.data;
  return {
    ok: true,
    profile: {
      schema_version: SCHEMA_VERSION,
      quality_status: d.quality_status,
      is_handwritten: d.is_handwritten,
      features: d.features as FeatureValues,
      characters: d.characters as CharacterValues,
      feature_confidence: d.feature_confidence as Partial<Record<FeatureName, number>>,
      overall_confidence: d.overall_confidence,
    },
  };
}

/** JSON schema shown to the model (kept in sync with the zod schema above). */
export function jsonSchemaForPrompt(): string {
  const f: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...ORDINAL_FEATURES, ...NOMINAL_FEATURES })) f[k] = [...v, UNKNOWN].join(" | ");
  const c: Record<string, string> = {};
  for (const k of CHARACTER_KEYS) c[k] = [...CHARACTER_FORMS, UNKNOWN].join(" | ");
  return JSON.stringify({
    quality_status: QUALITY_STATUSES.join(" | "),
    is_handwritten: "boolean",
    features: f,
    characters: c,
    feature_confidence: Object.fromEntries(Object.keys(f).map((k) => [k, "number 0..1"])),
    overall_confidence: "number 0..1",
  }, null, 2);
}
