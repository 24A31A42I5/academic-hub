/**
 * handwritingAnalysisService — the app-facing entry point.
 *   analyzeHandwriting(image) -> structured, validated ExtractedProfile
 * Runs N independent passes; a feature is kept only when a majority agree,
 * otherwise it becomes "unknown" (disagreement = not reliably observable).
 */
import { EXTRACTION_PROMPT } from "./prompt.ts";
import { parseExtraction, UNKNOWN, CHARACTER_KEYS, type ExtractedProfile, type FeatureName, type QualityStatus } from "./schema.ts";
import { EXTRACTION_PASSES } from "./config.ts";
import { ProviderError, type VisionProvider } from "./provider.ts";

export type AnalysisErrorType = "rate_limit" | "credits" | "ai_unavailable" | "malformed_response" | "config";

export type AnalysisResult =
  | { ok: true; profile: ExtractedProfile; passes: number; provider: string }
  | { ok: false; error_type: AnalysisErrorType; message: string };

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON object in response");
  return JSON.parse(m[0]);
}

function majority(values: string[], needed: number): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v && v !== UNKNOWN) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = UNKNOWN as string, n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return n >= needed ? best : UNKNOWN;
}

export function buildConsensus(profiles: ExtractedProfile[]): ExtractedProfile {
  if (profiles.length === 1) return profiles[0];
  const needed = Math.floor(profiles.length / 2) + 1;
  const base = profiles[0];
  const features = {} as Record<FeatureName, string>;
  const featureConfidence: Partial<Record<FeatureName, number>> = {};
  for (const f of Object.keys(base.features) as FeatureName[]) {
    const v = majority(profiles.map((p) => p.features[f]), needed);
    features[f] = v;
    if (v !== UNKNOWN) {
      const agreeing = profiles.filter((p) => p.features[f] === v);
      const meanConf = agreeing.reduce((s, p) => s + (p.feature_confidence[f] ?? p.overall_confidence), 0) / agreeing.length;
      featureConfidence[f] = Number((meanConf * (agreeing.length / profiles.length)).toFixed(3));
    }
  }
  const characters: ExtractedProfile["characters"] = {};
  for (const k of CHARACTER_KEYS) characters[k] = majority(profiles.map((p) => p.characters[k] ?? UNKNOWN), needed);

  const handwrittenVotes = profiles.filter((p) => p.is_handwritten).length;
  const quality = majority(profiles.map((p) => p.quality_status), needed) as QualityStatus | typeof UNKNOWN;
  return {
    schema_version: base.schema_version,
    quality_status: quality === UNKNOWN ? "insufficient_quality" : quality,
    is_handwritten: handwrittenVotes >= needed,
    features,
    characters,
    feature_confidence: featureConfidence,
    overall_confidence: Number((profiles.reduce((s, p) => s + p.overall_confidence, 0) / profiles.length).toFixed(3)),
  };
}

export async function analyzeHandwriting(
  provider: VisionProvider,
  imageBase64: string,
  mime = "image/jpeg",
  passes = EXTRACTION_PASSES,
): Promise<AnalysisResult> {
  const settled = await Promise.allSettled(
    Array.from({ length: passes }, async () => {
      const text = await provider.complete(EXTRACTION_PROMPT, imageBase64, mime);
      const parsed = parseExtraction(extractJson(text));
      if (!parsed.ok) throw new Error(`schema: ${parsed.error}`);
      return parsed.profile;
    }),
  );
  const good = settled.filter((s): s is PromiseFulfilledResult<ExtractedProfile> => s.status === "fulfilled").map((s) => s.value);

  if (good.length === 0) {
    const firstErr = (settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined)?.reason;
    if (firstErr instanceof ProviderError) {
      const map: Record<string, AnalysisErrorType> = { rate_limit: "rate_limit", credits: "credits", config: "config" };
      return { ok: false, error_type: map[firstErr.kind] ?? "ai_unavailable", message: firstErr.message };
    }
    console.error("All extraction passes failed:", firstErr);
    return { ok: false, error_type: "malformed_response", message: "The AI returned an unreadable response. Please try again." };
  }
  return { ok: true, profile: buildConsensus(good), passes: good.length, provider: provider.name };
}
