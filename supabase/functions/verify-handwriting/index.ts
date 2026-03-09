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

// ==================== CONFIGURATION ====================
const VERIFICATION_THRESHOLDS = {
  VERIFIED: 75,
  MANUAL_REVIEW: 50,
  REUPLOAD: 0
};

const MAX_BASE64_SIZE = 5 * 1024 * 1024;

interface PageResult {
  page: number;
  similarity: number;
  same_writer: boolean;
  is_handwritten: boolean;
  confidence: string;
}

// ==================== STRICT ENUM DEFINITIONS ====================

const VALID_ENUMS: Record<string, string[]> = {
  slant: ['left_lean', 'right_lean', 'upright'],
  stroke_weight: ['thin', 'medium', 'thick'],
  letter_spacing: ['tight', 'normal', 'wide'],
  word_spacing: ['tight', 'normal', 'wide'],
  baseline: ['straight', 'wavy', 'variable'],
  height_ratio: ['short', 'moderate', 'tall'],
  writing_style: ['cursive', 'print', 'mixed'],
  letter_shape: ['rounded', 'angular', 'looped', 'open', 'closed', 'simple', 'mixed'],
};

interface HandwritingProfile {
  slant: "left_lean" | "right_lean" | "upright";
  stroke_weight: "thin" | "medium" | "thick";
  letter_spacing: "tight" | "normal" | "wide";
  word_spacing: "tight" | "normal" | "wide";
  baseline: "straight" | "wavy" | "variable";
  height_ratio: "short" | "moderate" | "tall";
  writing_style: "cursive" | "print" | "mixed";
  letter_formations: {
    a: string;
    e: string;
    g: string;
    r: string;
    t: string;
    s: string;
  };
  confidence_level: number;
}

// ==================== NORMALIZATION (backward compat for old profiles) ====================

const SLANT_MAP: Record<string, HandwritingProfile["slant"]> = {
  "left": "left_lean", "left_lean": "left_lean", "left lean": "left_lean", "leftward": "left_lean",
  "right": "right_lean", "right_lean": "right_lean", "right lean": "right_lean", "rightward": "right_lean",
  "vertical": "upright", "upright": "upright", "straight": "upright", "none": "upright",
};

const WEIGHT_MAP: Record<string, HandwritingProfile["stroke_weight"]> = {
  "thin": "thin", "light": "thin", "fine": "thin",
  "medium": "medium", "moderate": "medium", "normal": "medium", "average": "medium",
  "thick": "thick", "heavy": "thick", "bold": "thick",
};

const SPACING_MAP: Record<string, "tight" | "normal" | "wide"> = {
  "tight": "tight", "cramped": "tight", "narrow": "tight", "close": "tight", "compressed": "tight",
  "normal": "normal", "moderate": "normal", "average": "normal", "regular": "normal",
  "wide": "wide", "broad": "wide", "spacious": "wide", "loose": "wide", "open": "wide",
};

const BASELINE_MAP: Record<string, HandwritingProfile["baseline"]> = {
  "straight": "straight", "stable": "straight", "consistent": "straight", "even": "straight", "level": "straight",
  "wavy": "wavy", "undulating": "wavy", "irregular": "wavy",
  "variable": "variable", "ascending": "variable", "descending": "variable", "varied": "variable", "inconsistent": "variable", "drifting": "variable",
};

const HEIGHT_MAP: Record<string, HandwritingProfile["height_ratio"]> = {
  "short": "short", "small": "short", "compact": "short", "low": "short",
  "moderate": "moderate", "medium": "moderate", "average": "moderate", "normal": "moderate",
  "tall": "tall", "large": "tall", "extended": "tall",
  "approximately twice": "tall", "twice the height": "tall", "2x": "tall", "2:1": "tall",
  "1.5": "moderate", "proportional": "moderate", "1.5:1": "moderate",
};

const STYLE_MAP: Record<string, HandwritingProfile["writing_style"]> = {
  "cursive": "cursive", "connected": "cursive", "script": "cursive", "flowing": "cursive",
  "print": "print", "block": "print", "disconnected": "print", "manuscript": "print",
  "mixed": "mixed", "hybrid": "mixed", "semi-cursive": "mixed", "partial": "mixed",
};

type LetterShape = "rounded" | "angular" | "looped" | "open" | "closed" | "simple" | "mixed";

const LETTER_SHAPE_MAP: Record<string, LetterShape> = {
  "rounded": "rounded", "round": "rounded", "oval": "rounded", "circular": "rounded", "curved": "rounded",
  "angular": "angular", "sharp": "angular", "pointed": "angular",
  "looped": "looped", "loop": "looped", "loopy": "looped",
  "open": "open", "unclosed": "open", "gap": "open",
  "closed": "closed", "sealed": "closed", "complete": "closed",
  "simple": "simple", "basic": "simple", "plain": "simple", "minimal": "simple",
  "mixed": "mixed", "hybrid": "mixed", "varied": "mixed",
};

function normalizeLetterShape(description: string | undefined | null): LetterShape {
  if (!description || description === "unknown") return "simple";
  const lower = description.toLowerCase();
  // Direct match first
  if (VALID_ENUMS.letter_shape.includes(lower)) return lower as LetterShape;
  for (const [keyword, shape] of Object.entries(LETTER_SHAPE_MAP)) {
    if (lower.includes(keyword)) return shape;
  }
  return "simple";
}

function mapEnum<T>(value: string | undefined | null, map: Record<string, T>): T | null {
  if (!value) return null;
  const key = String(value).toLowerCase().trim();
  // Exact match
  if (map[key]) return map[key];
  // Sort by key length (longest first) for specificity
  const sortedEntries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  // First try word-boundary regex match
  for (const [k, v] of sortedEntries) {
    try {
      const regex = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(key)) return v;
    } catch {
      // Fallback for regex issues
    }
  }
  // Then try simple includes (catches patterns like "2:1" in longer text)
  for (const [k, v] of sortedEntries) {
    if (key.includes(k)) return v;
  }
  return null;
}

function isStrictProfile(raw: any): boolean {
  // Check if profile already has strict enum values (v6.0+)
  return VALID_ENUMS.slant.includes(raw.slant) &&
    VALID_ENUMS.stroke_weight.includes(raw.stroke_weight) &&
    VALID_ENUMS.letter_spacing.includes(raw.letter_spacing);
}

function normalizeProfile(raw: any): HandwritingProfile | null {
  if (!raw || typeof raw !== 'object') return null;

  try {
    // If already strict enum format (v6.0+), use directly
    if (isStrictProfile(raw)) {
      const letter_formations = raw.letter_formations || {};
      return {
        slant: raw.slant,
        stroke_weight: raw.stroke_weight,
        letter_spacing: raw.letter_spacing,
        word_spacing: VALID_ENUMS.word_spacing.includes(raw.word_spacing) ? raw.word_spacing : 'normal',
        baseline: VALID_ENUMS.baseline.includes(raw.baseline) ? raw.baseline : 'straight',
        height_ratio: VALID_ENUMS.height_ratio.includes(raw.height_ratio) ? raw.height_ratio : 'moderate',
        writing_style: VALID_ENUMS.writing_style.includes(raw.writing_style) ? raw.writing_style : 'mixed',
        letter_formations: {
          a: VALID_ENUMS.letter_shape.includes(letter_formations.a) ? letter_formations.a : normalizeLetterShape(letter_formations.a),
          e: VALID_ENUMS.letter_shape.includes(letter_formations.e) ? letter_formations.e : normalizeLetterShape(letter_formations.e),
          g: VALID_ENUMS.letter_shape.includes(letter_formations.g) ? letter_formations.g : normalizeLetterShape(letter_formations.g),
          r: VALID_ENUMS.letter_shape.includes(letter_formations.r) ? letter_formations.r : normalizeLetterShape(letter_formations.r),
          t: VALID_ENUMS.letter_shape.includes(letter_formations.t) ? letter_formations.t : normalizeLetterShape(letter_formations.t),
          s: VALID_ENUMS.letter_shape.includes(letter_formations.s) ? letter_formations.s : normalizeLetterShape(letter_formations.s),
        },
        confidence_level: typeof raw.confidence_level === 'number' ? Math.max(0, Math.min(1, raw.confidence_level)) : 0.5,
      };
    }

    // Legacy normalization for old profiles (v3.0/v5.0)
    const rawSlant = raw.slant_and_baseline?.slant_direction ?? raw.slant_direction ?? raw.slant;
    const rawStroke = raw.stroke_characteristics?.stroke_width ?? raw.stroke_width ?? raw.stroke_weight;
    const rawLetterSpacing = raw.spacing?.letter_spacing ?? raw.letter_spacing;
    const rawWordSpacing = raw.spacing?.word_spacing ?? raw.word_spacing;
    const rawBaseline = raw.slant_and_baseline?.baseline_behavior ?? raw.baseline_behavior ?? raw.baseline;
    const rawHeightRatio = raw.slant_and_baseline?.height_ratio_upper_lower ?? raw.height_ratio_upper_lower ?? raw.height_ratio;
    const rawStyle = raw.stroke_characteristics?.connections ?? raw.connections ?? raw.writing_style;
    const rawConfidence = raw.confidence_level ?? raw.confidence ?? 0.5;

    const slant = mapEnum(rawSlant, SLANT_MAP);
    const stroke_weight = mapEnum(rawStroke, WEIGHT_MAP);
    const letter_spacing = mapEnum(rawLetterSpacing, SPACING_MAP);
    const word_spacing = mapEnum(rawWordSpacing, SPACING_MAP);
    const baseline = mapEnum(rawBaseline, BASELINE_MAP);
    const height_ratio = mapEnum(rawHeightRatio, HEIGHT_MAP);
    const writing_style = mapEnum(rawStyle, STYLE_MAP);

    if (!slant || !stroke_weight || !letter_spacing || !word_spacing || !baseline || !height_ratio || !writing_style) {
      console.log('normalizeProfile: missing required enum field', {
        slant, stroke_weight, letter_spacing, word_spacing, baseline, height_ratio, writing_style
      });
      return null;
    }

    const rawLetters = raw.letter_formation?.distinctive_letters ?? raw.distinctive_letters ?? raw.letter_formations ?? {};
    const letter_formations = {
      a: normalizeLetterShape(rawLetters.a ?? rawLetters.A),
      e: normalizeLetterShape(rawLetters.e ?? rawLetters.E),
      g: normalizeLetterShape(rawLetters.g ?? rawLetters.G),
      r: normalizeLetterShape(rawLetters.r ?? rawLetters.R),
      t: normalizeLetterShape(rawLetters.t ?? rawLetters.T),
      s: normalizeLetterShape(rawLetters.s ?? rawLetters.S),
    };

    const confidence_level = typeof rawConfidence === 'number' ? Math.max(0, Math.min(1, rawConfidence)) : 0.5;

    return { slant, stroke_weight, letter_spacing, word_spacing, baseline, height_ratio, writing_style, letter_formations, confidence_level };
  } catch (err) {
    console.error('normalizeProfile error:', err);
    return null;
  }
}

// ==================== STRICT EXTRACTION PROMPT ====================

// ==================== TOOL CALLING SCHEMA ====================

const EXTRACTION_TOOL = {
  type: "function" as const,
  function: {
    name: "report_handwriting_features",
    description: "Report the extracted handwriting features from the analyzed image.",
    parameters: {
      type: "object",
      properties: {
        slant: { type: "string", enum: ["left_lean", "right_lean", "upright"], description: "Vertical stroke angle" },
        stroke_weight: { type: "string", enum: ["thin", "medium", "thick"], description: "Line thickness" },
        letter_spacing: { type: "string", enum: ["tight", "normal", "wide"], description: "Space between letters" },
        word_spacing: { type: "string", enum: ["tight", "normal", "wide"], description: "Space between words" },
        baseline: { type: "string", enum: ["straight", "wavy", "variable"], description: "Line alignment" },
        height_ratio: { type: "string", enum: ["short", "moderate", "tall"], description: "Upper/lower height ratio" },
        writing_style: { type: "string", enum: ["cursive", "print", "mixed"], description: "Connection pattern" },
        letter_a: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_e: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_g: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_r: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_t: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_s: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        is_handwritten: { type: "boolean", description: "true if handwritten, false if typed/printed" },
        confidence_level: { type: "number", description: "Image quality 0.0-1.0" }
      },
      required: ["slant", "stroke_weight", "letter_spacing", "word_spacing", "baseline", "height_ratio", "writing_style", "letter_a", "letter_e", "letter_g", "letter_r", "letter_t", "letter_s", "is_handwritten", "confidence_level"],
      additionalProperties: false
    }
  }
};

const EXTRACTION_SYSTEM_PROMPT = `You are a forensic handwriting analyst. Analyze the handwriting image and extract biometric features using the report_handwriting_features tool.

ANALYSIS RULES:
- SLANT: Measure average vertical stroke angle. <85° = left_lean, 85-95° = upright, >95° = right_lean
- STROKE_WEIGHT: Compare to standard ballpoint pen. Thinner = thin, thicker = thick
- LETTER_SPACING: Letters touching = tight, large gaps = wide
- WORD_SPACING: Gaps narrow (<8mm) = tight, large (>15mm) = wide
- BASELINE: Straight line = straight, curves = wavy, inconsistent = variable
- HEIGHT_RATIO: Uppercase 2x+ taller = tall, 1.3-1.7x = moderate, barely taller = short
- WRITING_STYLE: Most connect = cursive, separated = print, partial = mixed
- LETTER SHAPES: rounded/angular/looped/open/closed/simple/mixed
- IS_HANDWRITTEN: true for handwritten, false for typed
- CONFIDENCE: 0.9 clear, 0.7 blurry, 0.5 poor`;

// ==================== FEATURE EXTRACTION (Stage 1) ====================

const EXTRACTION_ATTEMPTS = 3;

function pickMostFrequent<T extends string>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let bestValue = fallback;
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}

function buildConsensusProfile(profiles: HandwritingProfile[]): HandwritingProfile {
  const base = profiles[0];
  return {
    slant: pickMostFrequent(profiles.map((p) => p.slant), base.slant),
    stroke_weight: pickMostFrequent(profiles.map((p) => p.stroke_weight), base.stroke_weight),
    letter_spacing: pickMostFrequent(profiles.map((p) => p.letter_spacing), base.letter_spacing),
    word_spacing: pickMostFrequent(profiles.map((p) => p.word_spacing), base.word_spacing),
    baseline: pickMostFrequent(profiles.map((p) => p.baseline), base.baseline),
    height_ratio: pickMostFrequent(profiles.map((p) => p.height_ratio), base.height_ratio),
    writing_style: pickMostFrequent(profiles.map((p) => p.writing_style), base.writing_style),
    letter_formations: {
      a: pickMostFrequent(profiles.map((p) => p.letter_formations.a), base.letter_formations.a),
      e: pickMostFrequent(profiles.map((p) => p.letter_formations.e), base.letter_formations.e),
      g: pickMostFrequent(profiles.map((p) => p.letter_formations.g), base.letter_formations.g),
      r: pickMostFrequent(profiles.map((p) => p.letter_formations.r), base.letter_formations.r),
      t: pickMostFrequent(profiles.map((p) => p.letter_formations.t), base.letter_formations.t),
      s: pickMostFrequent(profiles.map((p) => p.letter_formations.s), base.letter_formations.s),
    },
    confidence_level: Math.max(0, Math.min(1, profiles.reduce((sum, p) => sum + (p.confidence_level || 0.8), 0) / profiles.length)),
  };
}

function toolCallToProfile(args: any): HandwritingProfile | null {
  try {
    const profile: HandwritingProfile = {
      slant: args.slant,
      stroke_weight: args.stroke_weight,
      letter_spacing: args.letter_spacing,
      word_spacing: args.word_spacing,
      baseline: args.baseline,
      height_ratio: args.height_ratio,
      writing_style: args.writing_style,
      letter_formations: {
        a: args.letter_a,
        e: args.letter_e,
        g: args.letter_g,
        r: args.letter_r,
        t: args.letter_t,
        s: args.letter_s,
      },
      confidence_level: typeof args.confidence_level === 'number'
        ? Math.max(0, Math.min(1, args.confidence_level))
        : 0.5,
    };
    // Validate all enums
    for (const field of ['slant', 'stroke_weight', 'letter_spacing', 'word_spacing', 'baseline', 'height_ratio', 'writing_style'] as const) {
      if (!VALID_ENUMS[field].includes(profile[field])) return null;
    }
    for (const letter of ['a', 'e', 'g', 'r', 't', 's'] as const) {
      if (!VALID_ENUMS.letter_shape.includes(profile.letter_formations[letter])) return null;
    }
    return profile;
  } catch {
    return null;
  }
}

async function extractPageFeaturesOnce(
  pageNumber: number,
  imageBase64: string,
  apiKey: string
): Promise<{ profile: HandwritingProfile | null; is_handwritten: boolean }> {
  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      temperature: 0,
      top_p: 0.1,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "function", function: { name: "report_handwriting_features" } },
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this handwriting sample and extract all biometric features using the tool.' },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
            }
          ]
        }
      ],
    }),
  });

  if (!aiResponse.ok) {
    const status = aiResponse.status;
    if (status === 429) throw new Error('Rate limit exceeded');
    if (status === 402) throw new Error('AI credits exhausted');
    throw new Error(`AI Gateway error: ${status}`);
  }

  const aiData = await aiResponse.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

  if (toolCall && toolCall.function.name === 'report_handwriting_features') {
    const args = typeof toolCall.function.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;
    
    const is_handwritten = args.is_handwritten !== false;
    const profile = toolCallToProfile(args);
    return { profile, is_handwritten };
  }

  // Fallback: try parsing content as JSON for backward compat
  const content = aiData.choices?.[0]?.message?.content || '';
  console.warn(`Page ${pageNumber}: No tool call, trying JSON fallback`);
  const jsonMatch = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim().match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const is_handwritten = parsed.is_handwritten !== false;
      const profile = normalizeProfile(parsed);
      return { profile, is_handwritten };
    } catch { /* fall through */ }
  }

  return { profile: null, is_handwritten: true };
}

async function extractPageFeatures(
  pageNumber: number,
  imageBase64: string,
  apiKey: string
): Promise<{ profile: HandwritingProfile | null; is_handwritten: boolean }> {
  console.log(`Extracting features for page ${pageNumber} with ${EXTRACTION_ATTEMPTS} attempts...`);

  const successfulProfiles: HandwritingProfile[] = [];
  let nonHandwrittenVotes = 0;

  for (let attempt = 1; attempt <= EXTRACTION_ATTEMPTS; attempt++) {
    const result = await extractPageFeaturesOnce(pageNumber, imageBase64, apiKey);

    if (!result.is_handwritten) {
      nonHandwrittenVotes++;
    }

    if (result.profile) {
      successfulProfiles.push(result.profile);
    }

    console.log(`Page ${pageNumber}: extraction attempt ${attempt}/${EXTRACTION_ATTEMPTS} -> ${result.profile ? 'ok' : 'failed'}, handwritten=${result.is_handwritten}`);
  }

  if (nonHandwrittenVotes >= 2) {
    return { profile: null, is_handwritten: false };
  }

  if (successfulProfiles.length === 0) {
    console.error(`Page ${pageNumber}: all extraction attempts failed`);
    return { profile: null, is_handwritten: true };
  }

  const profile = successfulProfiles.length === 1
    ? successfulProfiles[0]
    : buildConsensusProfile(successfulProfiles);

  console.log(`Page ${pageNumber}: extraction consensus from ${successfulProfiles.length}/${EXTRACTION_ATTEMPTS} attempts`);
  console.log(`Page ${pageNumber} profile:`, JSON.stringify(profile));

  return { profile, is_handwritten: true };
}

// ==================== WEIGHTED COMPARISON (Stage 2) ====================

interface WeightedComparisonResult {
  similarity_score: number;
  same_writer: boolean;
  confidence_level: number;
  key_observations: string[];
  rare_feature_matches: number;
  evidence_strength: string;
}

function compareProfilesWeighted(
  ref: HandwritingProfile,
  sub: HandwritingProfile,
  weightMap: Map<string, number>
): WeightedComparisonResult {
  let matchedWeightedScore = 0;
  let maxWeightedScore = 0;
  const matches: string[] = [];
  const differences: string[] = [];
  let rareMatchCount = 0;

  const getWeight = (category: string, value: string): number => {
    const key = `${category}:${value}`;
    return weightMap.get(key) ?? 0.5;
  };

  const compareFeature = (
    category: string,
    refValue: string,
    subValue: string,
    maxPoints: number,
    featureName: string
  ): void => {
    const weight = getWeight(category, refValue);
    const weightedMaxPoints = maxPoints * weight;
    maxWeightedScore += weightedMaxPoints;

    if (refValue !== subValue) {
      differences.push(`${featureName} differs (${refValue} vs ${subValue})`);
      return;
    }

    matchedWeightedScore += weightedMaxPoints;

    if (weight >= 0.7) {
      rareMatchCount++;
      matches.push(`${featureName}: ${refValue} [RARE, +${weightedMaxPoints.toFixed(1)}pts]`);
    } else {
      matches.push(`${featureName}: ${refValue} [+${weightedMaxPoints.toFixed(1)}pts]`);
    }
  };

  compareFeature('slant', ref.slant, sub.slant, 15, 'Slant');
  compareFeature('stroke_weight', ref.stroke_weight, sub.stroke_weight, 10, 'Stroke weight');
  compareFeature('letter_spacing', ref.letter_spacing, sub.letter_spacing, 15, 'Letter spacing');
  compareFeature('word_spacing', ref.word_spacing, sub.word_spacing, 10, 'Word spacing');
  compareFeature('baseline', ref.baseline, sub.baseline, 10, 'Baseline');
  compareFeature('height_ratio', ref.height_ratio, sub.height_ratio, 10, 'Height ratio');
  compareFeature('writing_style', ref.writing_style, sub.writing_style, 10, 'Writing style');

  // Letter formations (30 points total, 5 per letter), weighted by rarity
  const letters = ['a', 'e', 'g', 'r', 't', 's'] as const;
  for (const letter of letters) {
    const refShape = ref.letter_formations[letter];
    const subShape = sub.letter_formations[letter];

    if (!refShape) continue;

    if (!subShape) {
      const missingWeight = getWeight('letter_shape', refShape);
      maxWeightedScore += 5 * missingWeight;
      differences.push(`Letter ${letter} missing in submission (${refShape})`);
      continue;
    }

    compareFeature('letter_shape', refShape, subShape, 5, `Letter ${letter}`);
  }

  // Normalize weighted score to 0-100 so thresholds remain meaningful
  const normalizedScore = maxWeightedScore > 0
    ? (matchedWeightedScore / maxWeightedScore) * 100
    : 0;

  // Confidence adjustment
  const refConfidence = ref.confidence_level || 0.8;
  const subConfidence = sub.confidence_level || 0.8;
  const avgConfidence = (refConfidence + subConfidence) / 2;
  const confidenceAdjusted = normalizedScore * avgConfidence;
  const finalScore = Math.max(0, Math.min(100, Math.round(confidenceAdjusted)));

  // Dynamic threshold
  let threshold = 70;
  threshold -= rareMatchCount * 3;
  if (avgConfidence < 0.7) threshold += 5;
  threshold = Math.max(60, Math.min(threshold, 80));

  let evidenceStrength = 'weak';
  if (rareMatchCount >= 4) evidenceStrength = 'very_strong';
  else if (rareMatchCount >= 2) evidenceStrength = 'strong';
  else if (rareMatchCount >= 1) evidenceStrength = 'moderate';

  const topMatches = matches.slice(0, 6);
  const topDifferences = differences.slice(0, 3);
  const observations = [
    ...topMatches,
    ...topDifferences,
    `[Weighted: ${matchedWeightedScore.toFixed(1)}/${maxWeightedScore.toFixed(1)}, Norm: ${normalizedScore.toFixed(1)}, Conf: ${(avgConfidence * 100).toFixed(0)}%, Final: ${finalScore}, Thresh: ${threshold}, Rare: ${rareMatchCount}]`
  ];

  console.log(`Weighted comparison: matched=${matchedWeightedScore.toFixed(1)}, max=${maxWeightedScore.toFixed(1)}, norm=${normalizedScore.toFixed(1)}, final=${finalScore}, threshold=${threshold}, rare=${rareMatchCount}, evidence=${evidenceStrength}`);

  return {
    similarity_score: finalScore,
    same_writer: finalScore >= threshold,
    confidence_level: avgConfidence,
    key_observations: observations,
    rare_feature_matches: rareMatchCount,
    evidence_strength: evidenceStrength,
  };
}

// ==================== UNCHANGED UTILITIES ====================

async function fetchImageAsBase64(url: string, supabase: any): Promise<{ base64: string; size: number }> {
  console.log('Fetching image:', url);
  
  if (!url.startsWith('http')) {
    console.log('Generating signed URL for storage path:', url);
    const { data: signedData, error: signedError } = await supabase.storage
      .from('uploads')
      .createSignedUrl(url.split('?')[0], 300);
    
    if (signedError) {
      console.error('Error creating signed URL:', signedError);
      throw new Error(`Failed to access file: ${signedError.message}`);
    }
    url = signedData.signedUrl;
    console.log('Using signed URL for storage path');
  } else {
    const uploadsBucketMatch = url.match(/\/storage\/v1\/object\/public\/uploads\/(.+?)(\?.*)?$/);
    if (uploadsBucketMatch) {
      const filePath = uploadsBucketMatch[1];
      console.log('Generating signed URL for private bucket, path:', filePath);
      
      const { data: signedData, error: signedError } = await supabase.storage
        .from('uploads')
        .createSignedUrl(filePath, 300);
      
      if (signedError) {
        console.error('Error creating signed URL:', signedError);
        throw new Error(`Failed to access file: ${signedError.message}`);
      }
      
      url = signedData.signedUrl;
      console.log('Using signed URL');
    }
  }
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const base64 = encode(arrayBuffer);
  return { base64, size: arrayBuffer.byteLength };
}

function determineRiskLevel(score: number, hasCriticalFlag: boolean): string {
  if (hasCriticalFlag || score < VERIFICATION_THRESHOLDS.MANUAL_REVIEW) {
    return 'high';
  }
  if (score < VERIFICATION_THRESHOLDS.VERIFIED) {
    return 'medium';
  }
  return 'low';
}

function determineStatus(score: number, hasCriticalFlag: boolean, hasTypedContent: boolean): string {
  if (hasTypedContent) {
    return 'needs_manual_review';
  }
  if (hasCriticalFlag || score < VERIFICATION_THRESHOLDS.MANUAL_REVIEW) {
    return 'needs_manual_review';
  }
  if (score < VERIFICATION_THRESHOLDS.VERIFIED) {
    return 'needs_manual_review';
  }
  return 'verified';
}

type ErrorType = 'no_profile' | 'file_too_large' | 'ai_gateway_error' | 'parse_error' | 'rate_limit' | 'typed_content_detected' | 'unknown';

interface FallbackResult {
  score: number;
  risk_level: string;
  status: string;
  error_type: ErrorType;
  message: string;
}

function getFallbackResult(errorType: ErrorType): FallbackResult {
  switch (errorType) {
    case 'no_profile':
      return {
        score: 50,
        risk_level: 'medium',
        status: 'needs_manual_review',
        error_type: 'no_profile',
        message: 'No handwriting profile found. Please upload your handwriting sample first.'
      };
    case 'file_too_large':
      return {
        score: 50,
        risk_level: 'medium',
        status: 'needs_manual_review',
        error_type: 'file_too_large',
        message: 'Image too large for automatic verification. Manual review required.'
      };
    case 'typed_content_detected':
      return {
        score: 0,
        risk_level: 'high',
        status: 'needs_manual_review',
        error_type: 'typed_content_detected',
        message: 'Typed or printed content detected. Only handwritten pages are accepted.'
      };
    case 'rate_limit':
      return {
        score: 50,
        risk_level: 'medium',
        status: 'needs_manual_review',
        error_type: 'rate_limit',
        message: 'AI service busy. Your submission will be reviewed manually.'
      };
    case 'ai_gateway_error':
      return {
        score: 50,
        risk_level: 'medium',
        status: 'needs_manual_review',
        error_type: 'ai_gateway_error',
        message: 'AI analysis temporarily unavailable. Manual review required.'
      };
    case 'parse_error':
      return {
        score: 50,
        risk_level: 'medium',
        status: 'needs_manual_review',
        error_type: 'parse_error',
        message: 'Could not process AI response. Manual review required.'
      };
    default:
      return {
        score: 50,
        risk_level: 'medium',
        status: 'needs_manual_review',
        error_type: 'unknown',
        message: 'Verification encountered an issue. Manual review required.'
      };
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { submission_id, file_urls, file_url, student_profile_id, page_count } = body;

    const imageUrls: string[] = file_urls || (file_url ? [file_url] : []);

    console.log('=== WEIGHTED PROBABILISTIC HANDWRITING VERIFICATION v7.0-toolcall START ===');
    console.log('Submission ID:', submission_id);
    console.log('Image URLs:', imageUrls.length, 'pages');
    console.log('Student Profile ID:', student_profile_id);

    if (imageUrls.length === 0) {
      throw new Error('No image URLs provided');
    }

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load feature statistics for weighted comparison
    const { data: featureStats, error: statsError } = await supabase
      .from('feature_statistics')
      .select('feature_category, feature_value, discriminative_weight');

    if (statsError) {
      console.error('Failed to load feature statistics:', statsError);
    }

    const weightMap = new Map<string, number>();
    featureStats?.forEach((stat: any) => {
      const key = `${stat.feature_category}:${stat.feature_value}`;
      weightMap.set(key, stat.discriminative_weight);
    });
    console.log('Loaded', weightMap.size, 'feature weights');

    // Ownership verification
    const { data: ownerCheck } = await supabase
      .from('submissions')
      .select('student_profile_id')
      .eq('id', submission_id)
      .single();

    if (!ownerCheck || ownerCheck.student_profile_id !== student_profile_id) {
      throw new Error('Submission does not belong to the claimed student profile');
    }

    const { data: studentProfile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('id', student_profile_id)
      .single();

    for (const path of imageUrls) {
      const storagePath = path.startsWith('http')
        ? path.split('/uploads/')[1]?.split('?')[0]
        : path;
      if (storagePath && !storagePath.startsWith(studentProfile!.user_id + '/')) {
        throw new Error(`Access denied: file path does not belong to student`);
      }
    }

    // Fetch student's stored handwriting profile (reference)
    const { data: studentDetails, error: studentError } = await supabase
      .from('student_details')
      .select('handwriting_feature_embedding, handwriting_url, handwriting_features_extracted_at, roll_number')
      .eq('profile_id', student_profile_id)
      .single();

    if (studentError) {
      console.error('Error fetching student details:', studentError);
      throw new Error('Failed to fetch student details');
    }

    const handwritingProfile = studentDetails?.handwriting_feature_embedding;

    // If no handwriting profile exists, mark for manual review
    if (!handwritingProfile) {
      console.log('No handwriting profile found - marking for manual review');
      const fallback = getFallbackResult('no_profile');
      
      await supabase
        .from('submissions')
        .update({
          ai_similarity_score: fallback.score,
          ai_confidence_score: 0,
          ai_risk_level: fallback.risk_level,
          status: fallback.status,
          verified_at: new Date().toISOString(),
          ai_analysis_details: {
            algorithm_version: '6.0-weighted-probabilistic',
            error_type: fallback.error_type,
            reason: fallback.message,
            page_count: imageUrls.length,
            recommendation: 'Student needs to submit handwriting sample first'
          },
          page_verification_results: null,
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        ...fallback
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize the stored reference profile
    const referenceProfile = normalizeProfile(handwritingProfile);
    if (!referenceProfile) {
      console.error('Failed to normalize reference profile. Raw:', JSON.stringify(handwritingProfile));
      const fallback = getFallbackResult('no_profile');
      fallback.message = 'Handwriting profile could not be normalized. Please retrain your handwriting sample.';
      
      await supabase
        .from('submissions')
        .update({
          ai_similarity_score: fallback.score,
          ai_confidence_score: 0,
          ai_risk_level: fallback.risk_level,
          status: fallback.status,
          verified_at: new Date().toISOString(),
          ai_analysis_details: {
            algorithm_version: '6.0-weighted-probabilistic',
            error_type: 'parse_error',
            reason: fallback.message,
            page_count: imageUrls.length,
            recommendation: 'Student should retrain handwriting profile'
          },
          page_verification_results: null,
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        ...fallback
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Reference profile normalized:', JSON.stringify(referenceProfile));

    // Process each page: extract features then compare deterministically
    const pageResults: PageResult[] = [];
    let hasTypedContent = false;
    let hasDifferentWriter = false;
    let totalRareMatches = 0;
    let overallEvidenceStrength = 'weak';

    for (let i = 0; i < imageUrls.length; i++) {
      const pageUrl = imageUrls[i];
      const pageNum = i + 1;
      
      console.log(`Processing page ${pageNum}/${imageUrls.length}...`);

      try {
        const { base64: pageBase64, size: pageSize } = await fetchImageAsBase64(pageUrl, supabase);
        console.log(`Page ${pageNum} size:`, pageSize, 'bytes');

        // Check if image is too large
        if (pageBase64.length > MAX_BASE64_SIZE) {
          console.log(`Page ${pageNum} too large for AI processing`);
          pageResults.push({
            page: pageNum,
            similarity: 50,
            same_writer: false,
            is_handwritten: true,
            confidence: 'low'
          });
          continue;
        }

        // Stage 1: Extract features from submission page
        const { profile: submissionProfile, is_handwritten } = await extractPageFeatures(
          pageNum,
          pageBase64,
          LOVABLE_API_KEY
        );

        // Typed content detection
        if (!is_handwritten) {
          console.log(`Page ${pageNum}: typed/printed content detected`);
          hasTypedContent = true;
          pageResults.push({
            page: pageNum,
            similarity: 0,
            same_writer: false,
            is_handwritten: false,
            confidence: 'high'
          });
          continue;
        }

        // Extraction failed → fallback
        if (!submissionProfile) {
          console.log(`Page ${pageNum}: feature extraction failed, using fallback`);
          pageResults.push({
            page: pageNum,
            similarity: 50,
            same_writer: false,
            is_handwritten: true,
            confidence: 'low'
          });
          continue;
        }

        // Stage 2: Weighted deterministic comparison
        const comparison = compareProfilesWeighted(referenceProfile, submissionProfile, weightMap);
        console.log(`Page ${pageNum} weighted result:`, JSON.stringify(comparison));

        totalRareMatches += comparison.rare_feature_matches;
        if (comparison.evidence_strength === 'very_strong' || comparison.evidence_strength === 'strong') {
          overallEvidenceStrength = comparison.evidence_strength;
        }

        const confidenceStr = comparison.confidence_level >= 0.7 ? 'high' 
          : comparison.confidence_level >= 0.4 ? 'medium' : 'low';

        const pageResult: PageResult = {
          page: pageNum,
          similarity: comparison.similarity_score,
          same_writer: comparison.same_writer,
          is_handwritten: true,
          confidence: confidenceStr,
        };

        pageResults.push(pageResult);

        if (!pageResult.same_writer) {
          hasDifferentWriter = true;
        }

        console.log(`Page ${pageNum} result:`, pageResult);

      } catch (pageError: any) {
        console.error(`Error processing page ${pageNum}:`, pageError);
        pageResults.push({
          page: pageNum,
          similarity: 50,
          same_writer: false,
          is_handwritten: true,
          confidence: 'low'
        });
      }
    }

    // Conservative aggregation: use MINIMUM similarity across all pages
    const similarities = pageResults.map(p => p.similarity);
    const overallSimilarity = Math.min(...similarities);
    
    // All pages must be from same writer for overall = true
    const overallSameWriter = pageResults.every(p => p.same_writer) && !hasDifferentWriter;
    
    // Confidence is lowest if any page has issues
    const confidenceLevels = pageResults.map(p => p.confidence);
    const overallConfidence = confidenceLevels.includes('low') ? 'low' 
      : confidenceLevels.includes('medium') ? 'medium' 
      : 'high';
    const confidenceScore = overallConfidence === 'high' ? 90 : overallConfidence === 'medium' ? 70 : 50;

    // Determine final status
    const hasCriticalFlag = hasDifferentWriter || hasTypedContent;
    const riskLevel = determineRiskLevel(overallSimilarity, hasCriticalFlag);
    const status = determineStatus(overallSimilarity, hasCriticalFlag, hasTypedContent);

    // Build final reasoning
    let finalReasoning = '';
    if (hasTypedContent) {
      finalReasoning = 'One or more pages contain typed/printed content instead of handwriting. ';
    }
    if (hasDifferentWriter) {
      finalReasoning += 'Handwriting inconsistency detected across pages. ';
    }
    if (overallSameWriter && !hasTypedContent) {
      finalReasoning = `All ${pageResults.length} pages verified as same writer with ${overallSimilarity}% similarity.`;
    } else if (!hasTypedContent && !hasDifferentWriter) {
      finalReasoning = `Verification completed with ${overallSimilarity}% overall similarity across ${pageResults.length} pages.`;
    }

    console.log('=== AGGREGATION RESULTS ===');
    console.log('Overall Similarity:', overallSimilarity);
    console.log('Same Writer:', overallSameWriter);
    console.log('Has Typed Content:', hasTypedContent);
    console.log('Risk Level:', riskLevel);
    console.log('Status:', status);
    console.log('Total Rare Matches:', totalRareMatches);
    console.log('Evidence Strength:', overallEvidenceStrength);

    // Update submission with results
    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        ai_similarity_score: overallSimilarity,
        ai_confidence_score: confidenceScore,
        ai_risk_level: riskLevel,
        status: status,
        verified_at: new Date().toISOString(),
        ai_analysis_details: {
          algorithm_version: '6.0-weighted-probabilistic',
          page_count: pageResults.length,
          overall_similarity_score: overallSimilarity,
          same_writer: overallSameWriter,
          confidence_level: overallConfidence,
          has_typed_content: hasTypedContent,
          has_different_writer: hasDifferentWriter,
          aggregation_method: 'conservative_minimum',
          page_results: pageResults,
          final_reasoning: finalReasoning,
          rare_feature_matches: totalRareMatches,
          evidence_strength: overallEvidenceStrength,
          critical_flags: [
            ...(hasTypedContent ? ['typed_content_detected'] : []),
            ...(hasDifferentWriter ? ['different_writer_detected'] : [])
          ]
        },
        page_verification_results: pageResults,
        ai_flagged_sections: [
          ...(hasTypedContent ? ['typed_content_detected'] : []),
          ...(hasDifferentWriter ? ['different_writer_detected'] : [])
        ],
      })
      .eq('id', submission_id);

    if (updateError) {
      console.error('Error updating submission:', updateError);
      throw updateError;
    }

    console.log('=== VERIFICATION COMPLETE ===');

    return new Response(JSON.stringify({
      success: true,
      similarity_score: overallSimilarity,
      same_writer: overallSameWriter,
      risk_level: riskLevel,
      status: status,
      page_count: pageResults.length,
      page_results: pageResults,
      message: finalReasoning
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Verification error:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
