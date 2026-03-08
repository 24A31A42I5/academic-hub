import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ==================== CONFIG ====================
const THRESHOLDS = { VERIFIED: 75, MANUAL_REVIEW: 50 };
const MAX_BASE64_SIZE = 5 * 1024 * 1024;
const EXTRACTION_ATTEMPTS = 3;

// ==================== ENUMS ====================
const VALID_ENUMS: Record<string, string[]> = {
  slant: ['left_lean', 'right_lean', 'upright'],
  stroke_weight: ['thin', 'medium', 'thick'],
  letter_spacing: ['tight', 'normal', 'wide'],
  word_spacing: ['tight', 'normal', 'wide'],
  baseline: ['straight', 'wavy', 'variable'],
  height_ratio: ['short', 'moderate', 'tall'],
  writing_style: ['cursive', 'print', 'mixed'],
  letter_shape: ['rounded', 'angular', 'looped', 'open', 'closed', 'simple', 'mixed'],
  pen_pressure: ['light', 'medium', 'heavy'],
  line_quality: ['smooth', 'shaky', 'variable'],
  size_consistency: ['uniform', 'variable', 'decreasing'],
  t_cross_position: ['low', 'middle', 'high'],
  i_dot_style: ['round', 'dash', 'absent', 'circle'],
};

const CORE_FIELDS = ['slant', 'stroke_weight', 'letter_spacing', 'word_spacing', 'baseline', 'height_ratio', 'writing_style'] as const;
const EXTENDED_FIELDS = ['pen_pressure', 'line_quality', 'size_consistency', 't_cross_position', 'i_dot_style'] as const;
const LETTERS = ['a', 'e', 'g', 'r', 't', 's'] as const;

// ==================== PARTIAL MATCH SCORING ====================
// Near-miss values get partial credit instead of zero
const PARTIAL_SCORES: Record<string, number> = {
  // Slant
  'slant:left_lean:upright': 0.30, 'slant:upright:right_lean': 0.30, 'slant:left_lean:right_lean': 0.0,
  // Stroke weight
  'stroke_weight:thin:medium': 0.40, 'stroke_weight:medium:thick': 0.40, 'stroke_weight:thin:thick': 0.0,
  // Spacing (letter & word)
  'letter_spacing:tight:normal': 0.40, 'letter_spacing:normal:wide': 0.40, 'letter_spacing:tight:wide': 0.0,
  'word_spacing:tight:normal': 0.40, 'word_spacing:normal:wide': 0.40, 'word_spacing:tight:wide': 0.0,
  // Baseline
  'baseline:straight:wavy': 0.20, 'baseline:wavy:variable': 0.40, 'baseline:straight:variable': 0.10,
  // Height ratio
  'height_ratio:short:moderate': 0.40, 'height_ratio:moderate:tall': 0.40, 'height_ratio:short:tall': 0.0,
  // Writing style
  'writing_style:cursive:mixed': 0.40, 'writing_style:print:mixed': 0.40, 'writing_style:cursive:print': 0.0,
  // Pen pressure
  'pen_pressure:light:medium': 0.40, 'pen_pressure:medium:heavy': 0.40, 'pen_pressure:light:heavy': 0.0,
  // Line quality
  'line_quality:smooth:variable': 0.30, 'line_quality:shaky:variable': 0.40, 'line_quality:smooth:shaky': 0.0,
  // Size consistency
  'size_consistency:uniform:variable': 0.35, 'size_consistency:variable:decreasing': 0.35, 'size_consistency:uniform:decreasing': 0.0,
  // T cross
  't_cross_position:low:middle': 0.35, 't_cross_position:middle:high': 0.35, 't_cross_position:low:high': 0.0,
  // I dot
  'i_dot_style:round:circle': 0.50, 'i_dot_style:round:dash': 0.20, 'i_dot_style:dash:absent': 0.15,
  'i_dot_style:round:absent': 0.0, 'i_dot_style:circle:dash': 0.15, 'i_dot_style:circle:absent': 0.0,
  // Letter shapes
  'letter_shape:rounded:looped': 0.50, 'letter_shape:rounded:closed': 0.40, 'letter_shape:rounded:open': 0.30,
  'letter_shape:angular:simple': 0.30, 'letter_shape:looped:closed': 0.30, 'letter_shape:open:simple': 0.30,
  'letter_shape:rounded:simple': 0.25, 'letter_shape:angular:looped': 0.10, 'letter_shape:angular:open': 0.20,
  'letter_shape:angular:closed': 0.20, 'letter_shape:open:closed': 0.10, 'letter_shape:looped:simple': 0.20,
  'letter_shape:looped:open': 0.25, 'letter_shape:closed:simple': 0.30,
};

// "mixed" is partially similar to everything
function getPartialScore(category: string, a: string, b: string): number {
  if (a === b) return 1.0;
  if (a === 'mixed' || b === 'mixed') return 0.25;
  const k1 = `${category}:${a}:${b}`;
  const k2 = `${category}:${b}:${a}`;
  return PARTIAL_SCORES[k1] ?? PARTIAL_SCORES[k2] ?? 0;
}

// ==================== PROFILE TYPES & NORMALIZATION ====================

interface HandwritingProfile {
  slant: string; stroke_weight: string; letter_spacing: string; word_spacing: string;
  baseline: string; height_ratio: string; writing_style: string;
  pen_pressure?: string; line_quality?: string; size_consistency?: string;
  t_cross_position?: string; i_dot_style?: string;
  letter_formations: Record<string, string>;
  confidence_level: number;
}

interface PageResult {
  page: number; similarity: number; same_writer: boolean;
  is_handwritten: boolean; confidence: string;
}

// Legacy normalization maps
const SLANT_MAP: Record<string, string> = {
  left: 'left_lean', left_lean: 'left_lean', 'left lean': 'left_lean', leftward: 'left_lean',
  right: 'right_lean', right_lean: 'right_lean', 'right lean': 'right_lean', rightward: 'right_lean',
  vertical: 'upright', upright: 'upright', straight: 'upright', none: 'upright',
};
const WEIGHT_MAP: Record<string, string> = {
  thin: 'thin', light: 'thin', fine: 'thin', medium: 'medium', moderate: 'medium', normal: 'medium',
  average: 'medium', thick: 'thick', heavy: 'thick', bold: 'thick',
};
const SPACING_MAP: Record<string, string> = {
  tight: 'tight', cramped: 'tight', narrow: 'tight', close: 'tight', compressed: 'tight',
  normal: 'normal', moderate: 'normal', average: 'normal', regular: 'normal',
  wide: 'wide', broad: 'wide', spacious: 'wide', loose: 'wide', open: 'wide',
};
const BASELINE_MAP: Record<string, string> = {
  straight: 'straight', stable: 'straight', consistent: 'straight', even: 'straight', level: 'straight',
  wavy: 'wavy', undulating: 'wavy', irregular: 'wavy',
  variable: 'variable', ascending: 'variable', descending: 'variable', varied: 'variable', inconsistent: 'variable',
};
const HEIGHT_MAP: Record<string, string> = {
  short: 'short', small: 'short', compact: 'short', low: 'short',
  moderate: 'moderate', medium: 'moderate', average: 'moderate', normal: 'moderate',
  tall: 'tall', large: 'tall', extended: 'tall', 'approximately twice': 'tall', '2x': 'tall',
};
const STYLE_MAP: Record<string, string> = {
  cursive: 'cursive', connected: 'cursive', script: 'cursive', flowing: 'cursive',
  print: 'print', block: 'print', disconnected: 'print', manuscript: 'print',
  mixed: 'mixed', hybrid: 'mixed', 'semi-cursive': 'mixed', partial: 'mixed',
};
const SHAPE_MAP: Record<string, string> = {
  rounded: 'rounded', round: 'rounded', oval: 'rounded', circular: 'rounded', curved: 'rounded',
  angular: 'angular', sharp: 'angular', pointed: 'angular',
  looped: 'looped', loop: 'looped', loopy: 'looped',
  open: 'open', unclosed: 'open', gap: 'open',
  closed: 'closed', sealed: 'closed', complete: 'closed',
  simple: 'simple', basic: 'simple', plain: 'simple', minimal: 'simple',
  mixed: 'mixed', hybrid: 'mixed', varied: 'mixed',
};

function mapEnum(value: string | undefined | null, map: Record<string, string>): string | null {
  if (!value) return null;
  const key = String(value).toLowerCase().trim();
  if (map[key]) return map[key];
  for (const [k, v] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
    if (key.includes(k)) return v;
  }
  return null;
}

function normalizeShape(desc: string | undefined | null): string {
  if (!desc || desc === 'unknown') return 'simple';
  const lower = desc.toLowerCase();
  if (VALID_ENUMS.letter_shape.includes(lower)) return lower;
  return mapEnum(lower, SHAPE_MAP) ?? 'simple';
}

function isStrictProfile(raw: any): boolean {
  return VALID_ENUMS.slant.includes(raw.slant) &&
    VALID_ENUMS.stroke_weight.includes(raw.stroke_weight) &&
    VALID_ENUMS.letter_spacing.includes(raw.letter_spacing);
}

function normalizeProfile(raw: any): HandwritingProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    if (isStrictProfile(raw)) {
      const lf = raw.letter_formations || {};
      return {
        slant: raw.slant, stroke_weight: raw.stroke_weight,
        letter_spacing: raw.letter_spacing,
        word_spacing: VALID_ENUMS.word_spacing.includes(raw.word_spacing) ? raw.word_spacing : 'normal',
        baseline: VALID_ENUMS.baseline.includes(raw.baseline) ? raw.baseline : 'straight',
        height_ratio: VALID_ENUMS.height_ratio.includes(raw.height_ratio) ? raw.height_ratio : 'moderate',
        writing_style: VALID_ENUMS.writing_style.includes(raw.writing_style) ? raw.writing_style : 'mixed',
        pen_pressure: VALID_ENUMS.pen_pressure.includes(raw.pen_pressure) ? raw.pen_pressure : undefined,
        line_quality: VALID_ENUMS.line_quality.includes(raw.line_quality) ? raw.line_quality : undefined,
        size_consistency: VALID_ENUMS.size_consistency.includes(raw.size_consistency) ? raw.size_consistency : undefined,
        t_cross_position: VALID_ENUMS.t_cross_position.includes(raw.t_cross_position) ? raw.t_cross_position : undefined,
        i_dot_style: VALID_ENUMS.i_dot_style.includes(raw.i_dot_style) ? raw.i_dot_style : undefined,
        letter_formations: Object.fromEntries(LETTERS.map(l => [l,
          VALID_ENUMS.letter_shape.includes(lf[l]) ? lf[l] : normalizeShape(lf[l])
        ])),
        confidence_level: typeof raw.confidence_level === 'number' ? Math.max(0, Math.min(1, raw.confidence_level)) : 0.5,
      };
    }

    // Legacy normalization (v3-v6)
    const rs = raw.slant_and_baseline?.slant_direction ?? raw.slant_direction ?? raw.slant;
    const rw = raw.stroke_characteristics?.stroke_width ?? raw.stroke_width ?? raw.stroke_weight;
    const rls = raw.spacing?.letter_spacing ?? raw.letter_spacing;
    const rws = raw.spacing?.word_spacing ?? raw.word_spacing;
    const rb = raw.slant_and_baseline?.baseline_behavior ?? raw.baseline_behavior ?? raw.baseline;
    const rh = raw.slant_and_baseline?.height_ratio_upper_lower ?? raw.height_ratio_upper_lower ?? raw.height_ratio;
    const rst = raw.stroke_characteristics?.connections ?? raw.connections ?? raw.writing_style;

    const slant = mapEnum(rs, SLANT_MAP);
    const stroke_weight = mapEnum(rw, WEIGHT_MAP);
    const letter_spacing = mapEnum(rls, SPACING_MAP);
    const word_spacing = mapEnum(rws, SPACING_MAP);
    const baseline = mapEnum(rb, BASELINE_MAP);
    const height_ratio = mapEnum(rh, HEIGHT_MAP);
    const writing_style = mapEnum(rst, STYLE_MAP);

    if (!slant || !stroke_weight || !letter_spacing || !word_spacing || !baseline || !height_ratio || !writing_style) return null;

    const rl = raw.letter_formation?.distinctive_letters ?? raw.distinctive_letters ?? raw.letter_formations ?? {};
    const letter_formations = Object.fromEntries(LETTERS.map(l => [l, normalizeShape(rl[l] ?? rl[l.toUpperCase()])]));
    const confidence_level = typeof (raw.confidence_level ?? raw.confidence) === 'number'
      ? Math.max(0, Math.min(1, raw.confidence_level ?? raw.confidence)) : 0.5;

    return { slant, stroke_weight, letter_spacing, word_spacing, baseline, height_ratio, writing_style, letter_formations, confidence_level };
  } catch (err) {
    console.error('normalizeProfile error:', err);
    return null;
  }
}

// ==================== EXTRACTION PROMPT ====================

const EXTRACTION_PROMPT = `You are an expert forensic document examiner. Extract ALL biometric handwriting features. Return ONLY valid JSON with EXACT enum values.

FEATURES:
1. slant: "left_lean" | "right_lean" | "upright"
2. stroke_weight: "thin" | "medium" | "thick"
3. letter_spacing: "tight" | "normal" | "wide"
4. word_spacing: "tight" | "normal" | "wide"
5. baseline: "straight" | "wavy" | "variable"
6. height_ratio: "short" | "moderate" | "tall"
7. writing_style: "cursive" | "print" | "mixed"
8. pen_pressure: "light" | "medium" | "heavy"
9. line_quality: "smooth" | "shaky" | "variable"
10. size_consistency: "uniform" | "variable" | "decreasing"
11. t_cross_position: "low" | "middle" | "high"
12. i_dot_style: "round" | "dash" | "absent" | "circle"
13. letter_formations (a,e,g,r,t,s): "rounded"|"angular"|"looped"|"open"|"closed"|"simple"|"mixed"
14. is_handwritten: true/false
15. confidence_level: 0.0-1.0

JSON OUTPUT:
{"slant":"upright","stroke_weight":"medium","letter_spacing":"normal","word_spacing":"normal","baseline":"straight","height_ratio":"moderate","writing_style":"mixed","pen_pressure":"medium","line_quality":"smooth","size_consistency":"uniform","t_cross_position":"middle","i_dot_style":"round","letter_formations":{"a":"rounded","e":"open","g":"looped","r":"angular","t":"simple","s":"closed"},"is_handwritten":true,"confidence_level":0.9}`;

// ==================== FEATURE EXTRACTION ====================

function pickMostFrequent<T extends string>(values: (T | undefined | null)[], fallback: T): T {
  const filtered = values.filter((v): v is T => v != null);
  if (filtered.length === 0) return fallback;
  const counts = new Map<T, number>();
  for (const v of filtered) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = fallback, bestCount = -1;
  for (const [v, c] of counts) { if (c > bestCount) { best = v; bestCount = c; } }
  return best;
}

function buildConsensusProfile(profiles: HandwritingProfile[]): HandwritingProfile {
  const base = profiles[0];
  const result: any = {};
  for (const f of CORE_FIELDS) result[f] = pickMostFrequent(profiles.map(p => (p as any)[f]), (base as any)[f]);
  for (const f of EXTENDED_FIELDS) result[f] = pickMostFrequent(profiles.map(p => (p as any)[f]), (base as any)[f]);
  result.letter_formations = {};
  for (const l of LETTERS) result.letter_formations[l] = pickMostFrequent(profiles.map(p => p.letter_formations[l]), base.letter_formations[l] ?? 'simple');
  result.confidence_level = Math.max(0, Math.min(1, profiles.reduce((s, p) => s + (p.confidence_level || 0.8), 0) / profiles.length));
  return result;
}

async function extractFeaturesOnce(imageBase64: string): Promise<{ profile: HandwritingProfile | null; is_handwritten: boolean }> {
  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      temperature: 0, top_p: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: EXTRACTION_PROMPT },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      ]}],
    }),
  });

  if (!aiResponse.ok) {
    if (aiResponse.status === 429) throw new Error('Rate limit exceeded');
    if (aiResponse.status === 402) throw new Error('AI credits exhausted');
    throw new Error(`AI Gateway error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const text = (aiData.choices?.[0]?.message?.content || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { profile: null, is_handwritten: true };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { profile: normalizeProfile(parsed), is_handwritten: parsed.is_handwritten !== false };
  } catch { return { profile: null, is_handwritten: true }; }
}

async function extractPageFeatures(pageNum: number, imageBase64: string): Promise<{ profile: HandwritingProfile | null; is_handwritten: boolean }> {
  const profiles: HandwritingProfile[] = [];
  let notHandwritten = 0;

  for (let i = 1; i <= EXTRACTION_ATTEMPTS; i++) {
    try {
      const r = await extractFeaturesOnce(imageBase64);
      if (!r.is_handwritten) notHandwritten++;
      if (r.profile) profiles.push(r.profile);
      console.log(`Page ${pageNum} attempt ${i}/${EXTRACTION_ATTEMPTS}: ${r.profile ? 'ok' : 'fail'}, hw=${r.is_handwritten}`);
    } catch (e) {
      console.error(`Page ${pageNum} attempt ${i} error:`, e);
    }
  }

  if (notHandwritten >= 2) return { profile: null, is_handwritten: false };
  if (profiles.length === 0) return { profile: null, is_handwritten: true };

  return {
    profile: profiles.length === 1 ? profiles[0] : buildConsensusProfile(profiles),
    is_handwritten: true,
  };
}

// ==================== WEIGHTED COMPARISON WITH PARTIAL MATCHING ====================

interface ComparisonResult {
  similarity_score: number; same_writer: boolean; confidence_level: number;
  key_observations: string[]; key_matching_features: string[]; key_differences: string[];
  rare_feature_matches: number; evidence_strength: string;
}

function compareProfiles(
  ref: HandwritingProfile, sub: HandwritingProfile, weightMap: Map<string, number>
): ComparisonResult {
  let matchedScore = 0, maxScore = 0, rareMatchCount = 0;
  const matches: string[] = [], differences: string[] = [];

  const getWeight = (cat: string, val: string) => weightMap.get(`${cat}:${val}`) ?? 0.5;

  const compare = (cat: string, refV: string | undefined, subV: string | undefined, pts: number, name: string) => {
    if (!refV || !subV) return; // Skip if feature not available
    const weight = getWeight(cat, refV);
    const maxPts = pts * weight;
    maxScore += maxPts;

    const partial = getPartialScore(cat, refV, subV);
    const scored = maxPts * partial;
    matchedScore += scored;

    if (partial >= 1.0) {
      if (weight >= 0.7) { rareMatchCount++; matches.push(`${name}: ${refV} [RARE, +${scored.toFixed(1)}pts]`); }
      else matches.push(`${name}: ${refV} [+${scored.toFixed(1)}pts]`);
    } else if (partial > 0) {
      matches.push(`${name}: ~${refV}/${subV} [partial +${scored.toFixed(1)}pts]`);
    } else {
      differences.push(`${name}: ${refV} → ${subV}`);
    }
  };

  // Core features (80 max raw points)
  compare('slant', ref.slant, sub.slant, 15, 'Slant');
  compare('stroke_weight', ref.stroke_weight, sub.stroke_weight, 10, 'Stroke weight');
  compare('letter_spacing', ref.letter_spacing, sub.letter_spacing, 12, 'Letter spacing');
  compare('word_spacing', ref.word_spacing, sub.word_spacing, 8, 'Word spacing');
  compare('baseline', ref.baseline, sub.baseline, 10, 'Baseline');
  compare('height_ratio', ref.height_ratio, sub.height_ratio, 10, 'Height ratio');
  compare('writing_style', ref.writing_style, sub.writing_style, 10, 'Writing style');

  // Extended features (25 max raw points) — only scored if both profiles have them
  compare('pen_pressure', ref.pen_pressure, sub.pen_pressure, 8, 'Pen pressure');
  compare('line_quality', ref.line_quality, sub.line_quality, 5, 'Line quality');
  compare('size_consistency', ref.size_consistency, sub.size_consistency, 5, 'Size consistency');
  compare('t_cross_position', ref.t_cross_position, sub.t_cross_position, 4, 'T-cross position');
  compare('i_dot_style', ref.i_dot_style, sub.i_dot_style, 3, 'I-dot style');

  // Letter formations (30 max raw points)
  for (const l of LETTERS) {
    compare('letter_shape', ref.letter_formations[l], sub.letter_formations[l], 5, `Letter '${l}'`);
  }

  const normalized = maxScore > 0 ? (matchedScore / maxScore) * 100 : 0;
  const avgConf = ((ref.confidence_level || 0.8) + (sub.confidence_level || 0.8)) / 2;
  const adjusted = normalized * avgConf;
  const finalScore = Math.max(0, Math.min(100, Math.round(adjusted)));

  // Dynamic threshold
  let threshold = 70;
  threshold -= rareMatchCount * 3;
  if (avgConf < 0.7) threshold += 5;
  threshold = Math.max(55, Math.min(threshold, 80));

  const evidenceStrength = rareMatchCount >= 5 ? 'very_strong' : rareMatchCount >= 3 ? 'strong' : rareMatchCount >= 1 ? 'moderate' : 'weak';

  const observations = [
    ...matches.slice(0, 8), ...differences.slice(0, 4),
    `[Score: ${matchedScore.toFixed(1)}/${maxScore.toFixed(1)}, Norm: ${normalized.toFixed(1)}, Conf: ${(avgConf * 100).toFixed(0)}%, Final: ${finalScore}, Thresh: ${threshold}, Rare: ${rareMatchCount}]`
  ];

  return {
    similarity_score: finalScore, same_writer: finalScore >= threshold,
    confidence_level: avgConf, key_observations: observations,
    key_matching_features: matches, key_differences: differences,
    rare_feature_matches: rareMatchCount, evidence_strength: evidenceStrength,
  };
}

// ==================== ROBUST AGGREGATION ====================

function aggregatePages(results: PageResult[]): { score: number; sameWriter: boolean } {
  const handwrittenResults = results.filter(p => p.is_handwritten);
  if (handwrittenResults.length === 0) return { score: 0, sameWriter: false };

  const scores = handwrittenResults.map(p => p.similarity).sort((a, b) => a - b);

  let aggregatedScore: number;
  if (scores.length <= 2) {
    // For 1-2 pages: use minimum (conservative)
    aggregatedScore = scores[0];
  } else if (scores.length <= 5) {
    // For 3-5 pages: drop worst outlier, use median of rest
    const trimmed = scores.slice(1);
    aggregatedScore = trimmed[Math.floor(trimmed.length / 2)];
  } else {
    // For 6+ pages: drop bottom 15%, use median
    const dropCount = Math.max(1, Math.floor(scores.length * 0.15));
    const trimmed = scores.slice(dropCount);
    aggregatedScore = trimmed[Math.floor(trimmed.length / 2)];
  }

  // Cross-page consistency bonus: if >75% pages agree on same_writer, boost by up to 5
  const sameWriterCount = handwrittenResults.filter(p => p.same_writer).length;
  const sameWriterRatio = sameWriterCount / handwrittenResults.length;
  if (sameWriterRatio >= 0.75 && aggregatedScore >= 50) {
    aggregatedScore = Math.min(100, aggregatedScore + Math.round(sameWriterRatio * 5));
  }

  const overallSameWriter = handwrittenResults.every(p => p.same_writer);
  return { score: aggregatedScore, sameWriter: overallSameWriter };
}

// ==================== UTILITIES ====================

async function fetchImageAsBase64(url: string, supabase: any): Promise<{ base64: string; size: number }> {
  if (!url.startsWith('http')) {
    const { data, error } = await supabase.storage.from('uploads').createSignedUrl(url.split('?')[0], 300);
    if (error) throw new Error(`Failed to access file: ${error.message}`);
    url = data.signedUrl;
  } else {
    const m = url.match(/\/storage\/v1\/object\/public\/uploads\/(.+?)(\?.*)?$/);
    if (m) {
      const { data, error } = await supabase.storage.from('uploads').createSignedUrl(m[1], 300);
      if (error) throw new Error(`Failed to access file: ${error.message}`);
      url = data.signedUrl;
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const ab = await response.arrayBuffer();
  return { base64: encode(ab), size: ab.byteLength };
}

function determineRiskLevel(score: number, critical: boolean): string {
  if (critical || score < THRESHOLDS.MANUAL_REVIEW) return 'high';
  if (score < THRESHOLDS.VERIFIED) return 'medium';
  return 'low';
}

function determineStatus(score: number, critical: boolean, typed: boolean): string {
  if (typed || critical || score < THRESHOLDS.VERIFIED) return 'needs_manual_review';
  return 'verified';
}

type ErrorType = 'no_profile' | 'file_too_large' | 'ai_gateway_error' | 'parse_error' | 'rate_limit' | 'typed_content_detected' | 'unknown';

function getFallback(errorType: ErrorType) {
  const map: Record<ErrorType, { score: number; risk: string; status: string; msg: string }> = {
    no_profile: { score: 50, risk: 'medium', status: 'needs_manual_review', msg: 'No handwriting profile found. Please upload your handwriting sample first.' },
    file_too_large: { score: 50, risk: 'medium', status: 'needs_manual_review', msg: 'Image too large for automatic verification.' },
    typed_content_detected: { score: 0, risk: 'high', status: 'needs_manual_review', msg: 'Typed/printed content detected.' },
    rate_limit: { score: 50, risk: 'medium', status: 'needs_manual_review', msg: 'AI service busy. Manual review required.' },
    ai_gateway_error: { score: 50, risk: 'medium', status: 'needs_manual_review', msg: 'AI temporarily unavailable.' },
    parse_error: { score: 50, risk: 'medium', status: 'needs_manual_review', msg: 'Could not process AI response.' },
    unknown: { score: 50, risk: 'medium', status: 'needs_manual_review', msg: 'Verification issue. Manual review required.' },
  };
  return map[errorType] ?? map.unknown;
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { submission_id, file_urls, file_url, student_profile_id } = body;
    const imageUrls: string[] = file_urls || (file_url ? [file_url] : []);

    console.log('=== HANDWRITING VERIFICATION v7.0 START ===');
    console.log('Submission:', submission_id, '| Pages:', imageUrls.length);

    if (imageUrls.length === 0) throw new Error('No image URLs provided');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load feature weights
    const { data: featureStats } = await supabase.from('feature_statistics').select('feature_category, feature_value, discriminative_weight');
    const weightMap = new Map<string, number>();
    featureStats?.forEach((s: any) => weightMap.set(`${s.feature_category}:${s.feature_value}`, s.discriminative_weight));
    console.log('Loaded', weightMap.size, 'feature weights');

    // Ownership verification
    const { data: ownerCheck } = await supabase.from('submissions').select('student_profile_id').eq('id', submission_id).single();
    if (!ownerCheck || ownerCheck.student_profile_id !== student_profile_id) throw new Error('Ownership mismatch');

    const { data: studentProfile } = await supabase.from('profiles').select('user_id').eq('id', student_profile_id).single();
    for (const path of imageUrls) {
      const sp = path.startsWith('http') ? path.split('/uploads/')[1]?.split('?')[0] : path;
      if (sp && !sp.startsWith(studentProfile!.user_id + '/')) throw new Error('Access denied: file mismatch');
    }

    // Fetch reference profile
    const { data: studentDetails } = await supabase
      .from('student_details')
      .select('handwriting_feature_embedding, handwriting_url, handwriting_features_extracted_at, roll_number')
      .eq('profile_id', student_profile_id).single();

    const storeFallback = async (errorType: ErrorType, extra?: string) => {
      const fb = getFallback(errorType);
      await supabase.from('submissions').update({
        ai_similarity_score: fb.score, ai_confidence_score: 0, ai_risk_level: fb.risk,
        status: fb.status, verified_at: new Date().toISOString(),
        ai_analysis_details: {
          algorithm_version: '7.0-enhanced-probabilistic', error_type: errorType,
          reason: extra || fb.msg, page_count: imageUrls.length,
        },
        page_verification_results: null,
      }).eq('id', submission_id);
      return new Response(JSON.stringify({ success: true, ...fb }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    };

    if (!studentDetails?.handwriting_feature_embedding) {
      console.log('No profile → manual review');
      return await storeFallback('no_profile');
    }

    const referenceProfile = normalizeProfile(studentDetails.handwriting_feature_embedding);
    if (!referenceProfile) {
      console.error('Failed to normalize reference profile');
      return await storeFallback('no_profile', 'Profile could not be normalized. Please retrain.');
    }

    console.log('Reference profile normalized. Has extended features:', !!referenceProfile.pen_pressure);

    // Process each page
    const pageResults: PageResult[] = [];
    let hasTyped = false, hasDiffWriter = false, totalRare = 0;
    let bestEvidence = 'weak';

    for (let i = 0; i < imageUrls.length; i++) {
      const pageNum = i + 1;
      console.log(`Processing page ${pageNum}/${imageUrls.length}...`);

      try {
        const { base64, size } = await fetchImageAsBase64(imageUrls[i], supabase);
        console.log(`Page ${pageNum}: ${size} bytes`);

        if (base64.length > MAX_BASE64_SIZE) {
          pageResults.push({ page: pageNum, similarity: 50, same_writer: false, is_handwritten: true, confidence: 'low' });
          continue;
        }

        const { profile: subProfile, is_handwritten } = await extractPageFeatures(pageNum, base64);

        if (!is_handwritten) {
          hasTyped = true;
          pageResults.push({ page: pageNum, similarity: 0, same_writer: false, is_handwritten: false, confidence: 'high' });
          continue;
        }

        if (!subProfile) {
          pageResults.push({ page: pageNum, similarity: 50, same_writer: false, is_handwritten: true, confidence: 'low' });
          continue;
        }

        const cmp = compareProfiles(referenceProfile, subProfile, weightMap);
        totalRare += cmp.rare_feature_matches;
        if (['very_strong', 'strong'].includes(cmp.evidence_strength)) bestEvidence = cmp.evidence_strength;

        const conf = cmp.confidence_level >= 0.7 ? 'high' : cmp.confidence_level >= 0.4 ? 'medium' : 'low';
        const pr: PageResult = { page: pageNum, similarity: cmp.similarity_score, same_writer: cmp.same_writer, is_handwritten: true, confidence: conf };
        pageResults.push(pr);
        if (!pr.same_writer) hasDiffWriter = true;

        console.log(`Page ${pageNum}: score=${cmp.similarity_score}, same=${cmp.same_writer}, evidence=${cmp.evidence_strength}`);
      } catch (err: any) {
        console.error(`Page ${pageNum} error:`, err);
        pageResults.push({ page: pageNum, similarity: 50, same_writer: false, is_handwritten: true, confidence: 'low' });
      }
    }

    // Robust aggregation
    const { score: overallScore, sameWriter: overallSameWriter } = aggregatePages(pageResults);

    const confLevels = pageResults.map(p => p.confidence);
    const overallConf = confLevels.includes('low') ? 'low' : confLevels.includes('medium') ? 'medium' : 'high';
    const confScore = overallConf === 'high' ? 90 : overallConf === 'medium' ? 70 : 50;

    const hasCritical = hasDiffWriter || hasTyped;
    const riskLevel = determineRiskLevel(overallScore, hasCritical);
    const status = determineStatus(overallScore, hasCritical, hasTyped);

    let reasoning = '';
    if (hasTyped) reasoning = 'Typed/printed content detected. ';
    if (hasDiffWriter) reasoning += 'Different writer detected on some pages. ';
    if (overallSameWriter && !hasTyped) reasoning = `All ${pageResults.length} pages verified as same writer (${overallScore}% similarity).`;
    else if (!hasTyped && !hasDiffWriter) reasoning = `Verification: ${overallScore}% similarity across ${pageResults.length} pages.`;

    // Collect matching features and differences from all page comparisons for the first page
    // (for detailed display we re-compare to get the info)
    let allMatches: string[] = [];
    let allDiffs: string[] = [];
    if (pageResults.length > 0 && pageResults[0].is_handwritten) {
      // Use the first page's comparison for display
      try {
        const { base64: firstBase64 } = await fetchImageAsBase64(imageUrls[0], supabase);
        if (firstBase64.length <= MAX_BASE64_SIZE) {
          const { profile: firstSub } = await extractFeaturesOnce(firstBase64);
          if (firstSub) {
            const firstCmp = compareProfiles(referenceProfile, firstSub, weightMap);
            allMatches = firstCmp.key_matching_features;
            allDiffs = firstCmp.key_differences;
          }
        }
      } catch { /* ignore re-extract errors */ }
    }

    console.log(`=== AGGREGATION: score=${overallScore}, same=${overallSameWriter}, typed=${hasTyped}, risk=${riskLevel}, rare=${totalRare}, evidence=${bestEvidence} ===`);

    await supabase.from('submissions').update({
      ai_similarity_score: overallScore,
      ai_confidence_score: confScore,
      ai_risk_level: riskLevel,
      status,
      verified_at: new Date().toISOString(),
      ai_analysis_details: {
        algorithm_version: '7.0-enhanced-probabilistic',
        page_count: pageResults.length,
        overall_similarity_score: overallScore,
        same_writer: overallSameWriter,
        confidence_level: overallConf,
        has_typed_content: hasTyped,
        has_different_writer: hasDiffWriter,
        aggregation_method: 'trimmed_median_with_consistency_bonus',
        page_results: pageResults,
        final_reasoning: reasoning,
        rare_feature_matches: totalRare,
        evidence_strength: bestEvidence,
        key_matching_features: allMatches.slice(0, 10),
        key_differences: allDiffs.slice(0, 6),
        critical_flags: [
          ...(hasTyped ? ['typed_content_detected'] : []),
          ...(hasDiffWriter ? ['different_writer_detected'] : []),
        ],
      },
      page_verification_results: pageResults,
      ai_flagged_sections: [
        ...(hasTyped ? ['typed_content_detected'] : []),
        ...(hasDiffWriter ? ['different_writer_detected'] : []),
      ],
    }).eq('id', submission_id);

    console.log('=== VERIFICATION v7.0 COMPLETE ===');

    return new Response(JSON.stringify({
      success: true, similarity_score: overallScore, same_writer: overallSameWriter,
      risk_level: riskLevel, status, page_count: pageResults.length, message: reasoning,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Verification error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
