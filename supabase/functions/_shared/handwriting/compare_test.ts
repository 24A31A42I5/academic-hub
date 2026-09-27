import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aggregate, aggregatePages, comparePage, comparePair, normalizeOrdinal } from "./compare.ts";
import { parseExtraction, type ExtractedProfile } from "./schema.ts";
import { buildConsensus } from "./analysisService.ts";

const make = (over: Partial<ExtractedProfile["features"]> = {}, extra: Partial<ExtractedProfile> = {}): ExtractedProfile => ({
  schema_version: "8.0-consistency",
  quality_status: "ok",
  is_handwritten: true,
  features: {
    slant: "right", stroke_weight: "medium", letter_spacing: "normal", word_spacing: "wide",
    baseline: "slightly_wavy", letter_height: "medium", ascender_ratio: "moderate",
    writing_style: "mixed", connectivity: "partial", letter_roundness: "rounded", loop_size: "small",
    line_direction: "level", ...over,
  } as ExtractedProfile["features"],
  characters: { a: "rounded", e: "looped", g: "looped", r: "simple", t: "simple", s: "closed" },
  feature_confidence: {},
  overall_confidence: 0.9,
  ...extra,
});

Deno.test("ordinal normalization maps slant to -1/0/+1 scale", () => {
  assertEquals(normalizeOrdinal("slant", "left"), 0);
  assertEquals(normalizeOrdinal("slant", "upright"), 0.5);
  assertEquals(normalizeOrdinal("slant", "right"), 1);
  assertEquals(normalizeOrdinal("slant", "unknown"), null);
});

Deno.test("identical profiles score 100", () => {
  assertEquals(comparePair(make(), make()).similarity, 100);
});

Deno.test("opposite slant lowers score but adjacent value gets partial credit", () => {
  const opposite = comparePair(make(), make({ slant: "left" })).similarity!;
  const adjacent = comparePair(make(), make({ slant: "upright" })).similarity!;
  assert(opposite < adjacent && adjacent < 100);
});

Deno.test("unknown features are dropped and weights renormalized", () => {
  const r = comparePair(make(), make({ slant: "unknown", stroke_weight: "unknown" }));
  assertEquals(r.similarity, 100);
  assert(r.coverage < 1);
});

Deno.test("low-confidence features are ignored", () => {
  const r = comparePair(make(), make({ slant: "left" }, { feature_confidence: { slant: 0.1 } }));
  assertEquals(r.similarity, 100);
});

Deno.test("too little observable evidence yields null, not a mismatch", () => {
  const blank = make(Object.fromEntries(Object.keys(make().features).map((k) => [k, "unknown"])) as never, { characters: {} });
  assertEquals(comparePair(make(), blank).similarity, null);
});

Deno.test("aggregation methods", () => {
  assertEquals(aggregate([60, 70, 80, 90], "mean"), 75);
  assertEquals(aggregate([60, 70, 80, 90], "median"), 75);
  assertEquals(aggregate([60, 70, 80, 90], "trimmed_mean"), 70);
  assertEquals(aggregate([60, 70, 80], "trimmed_mean"), 70);
  assertEquals(aggregate([], "mean"), null);
});

Deno.test("page compared against all samples of the student", () => {
  const samples = [make(), make({ word_spacing: "normal" }), make({ slant: "upright" })].map((p, i) => ({ id: `s${i}`, profile: p }));
  const r = comparePage(1, make(), samples);
  assertEquals(r.status, "compared");
  assertEquals(r.per_sample_scores.length, 3);
  assert(r.similarity! > 80);
});

Deno.test("invalid-quality and typed pages are not scored as mismatch", () => {
  const s = [{ id: "s", profile: make() }];
  assertEquals(comparePage(1, make({}, { quality_status: "insufficient_quality" }), s).similarity, null);
  assertEquals(comparePage(2, make({}, { is_handwritten: false, quality_status: "not_handwriting" }), s).status, "not_handwriting");
  assertEquals(comparePage(3, make({}, { overall_confidence: 0.2 }), s).status, "low_confidence");
});

Deno.test("assignment aggregation ignores invalid pages", () => {
  const s = [{ id: "s", profile: make() }];
  const pages = [comparePage(1, make(), s), comparePage(2, make({}, { quality_status: "insufficient_quality" }), s)];
  const a = aggregatePages(pages);
  assertEquals(a.valid_pages, 1);
  assertEquals(a.invalid_pages, [2]);
  assertEquals(a.similarity, 100);
});

Deno.test("schema validation coerces bad enums to unknown and rejects missing structure", () => {
  const ok = parseExtraction({ quality_status: "ok", is_handwritten: true, features: { slant: "diagonal", stroke_weight: "Medium" }, overall_confidence: 0.8 });
  assert(ok.ok);
  if (ok.ok) {
    assertEquals(ok.profile.features.slant, "unknown");
    assertEquals(ok.profile.features.stroke_weight, "medium");
    assertEquals(ok.profile.features.baseline, "unknown");
  }
  assertEquals(parseExtraction({ foo: 1 }).ok, false);
  assertEquals(parseExtraction("not json").ok, false);
});

Deno.test("consensus turns disagreement into unknown", () => {
  const c = buildConsensus([make({ slant: "left" }), make({ slant: "right" }), make({ slant: "upright" })]);
  assertEquals(c.features.slant, "unknown");
  assertEquals(c.features.stroke_weight, "medium");
});
