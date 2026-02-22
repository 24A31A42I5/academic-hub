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
  VERIFIED: 75,        // >= 75: Verified (same writer)
  MANUAL_REVIEW: 50,   // 50-74: Manual Review required
  REUPLOAD: 0          // < 50: Reupload Required
};

// Maximum base64 size to send to AI (5MB encoded = ~3.75MB file)
const MAX_BASE64_SIZE = 5 * 1024 * 1024;

interface PageResult {
  page: number;
  similarity: number;
  same_writer: boolean;
  is_handwritten: boolean;
  confidence: string;
}

// ==================== DETERMINISTIC PROFILE TYPES ====================

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

interface ComparisonResult {
  similarity_score: number;
  same_writer: boolean;
  confidence_level: number;
  key_observations: string[];
}

// ==================== NORMALIZATION ====================

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
  // Descriptive phrases
  "approximately twice": "tall", "twice the height": "tall", "2x": "tall",
  "1.5": "moderate", "proportional": "moderate",
};

const STYLE_MAP: Record<string, HandwritingProfile["writing_style"]> = {
  "cursive": "cursive", "connected": "cursive", "script": "cursive", "flowing": "cursive",
  "print": "print", "block": "print", "disconnected": "print", "manuscript": "print",
  "mixed": "mixed", "hybrid": "mixed", "semi-cursive": "mixed", "partial": "mixed",
};

// Letter formation shape categories for deterministic comparison
type LetterShape = "rounded" | "angular" | "looped" | "open" | "closed" | "simple" | "mixed";

const LETTER_SHAPE_MAP: Record<string, LetterShape> = {
  "rounded": "rounded", "round": "rounded", "oval": "rounded", "circular": "rounded", "curved": "rounded",
  "angular": "angular", "sharp": "angular", "pointed": "angular", "straight": "angular",
  "looped": "looped", "loop": "looped", "loopy": "looped",
  "open": "open", "unclosed": "open", "gap": "open",
  "closed": "closed", "sealed": "closed", "complete": "closed",
  "simple": "simple", "basic": "simple", "plain": "simple", "minimal": "simple",
  "mixed": "mixed", "hybrid": "mixed", "varied": "mixed",
};

function normalizeLetterShape(description: string | undefined | null): LetterShape {
  if (!description || description === "unknown") return "simple";
  const lower = description.toLowerCase();
  // Priority order: check most distinctive shapes first
  for (const [keyword, shape] of Object.entries(LETTER_SHAPE_MAP)) {
    if (lower.includes(keyword)) return shape;
  }
  return "simple";
}

function mapEnum<T>(value: string | undefined | null, map: Record<string, T>): T | null {
  if (!value) return null;
  const key = String(value).toLowerCase().trim();
  // Exact match first
  if (map[key]) return map[key];
  // Multi-word key match (for phrases like "approximately twice")
  // Check longest keys first to prioritize specific matches
  const sortedEntries = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
  for (const [k, v] of sortedEntries) {
    // Use word boundary check: the key must appear as a standalone word/phrase
    const regex = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(key)) return v;
  }
  return null;
}

function normalizeProfile(raw: any): HandwritingProfile | null {
  if (!raw || typeof raw !== 'object') return null;

  try {
    // Extract slant from various possible locations in the raw profile
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

    // Any required enum field missing → null
    if (!slant || !stroke_weight || !letter_spacing || !word_spacing || !baseline || !height_ratio || !writing_style) {
      console.log('normalizeProfile: missing required enum field', {
        slant, stroke_weight, letter_spacing, word_spacing, baseline, height_ratio, writing_style
      });
      return null;
    }

    // Extract letter formations and normalize to shape categories
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

    return {
      slant,
      stroke_weight,
      letter_spacing,
      word_spacing,
      baseline,
      height_ratio,
      writing_style,
      letter_formations,
      confidence_level,
    };
  } catch (err) {
    console.error('normalizeProfile error:', err);
    return null;
  }
}

// ==================== FEATURE EXTRACTION (Stage 1) ====================

const EXTRACTION_PROMPT = `You are a FORENSIC DOCUMENT EXAMINER creating a biometric writer profile for writer identification purposes.

CRITICAL: This is NOT image description, NOT transcription, NOT layout analysis, NOT visual similarity measurement.

COMPLETELY IGNORE:
- Words written, their meaning, topic, or content
- Page layout and text positioning
- Image quality, resolution, or lighting
- Background texture or paper type
- Ink color or pen type
- Visual noise or artifacts

Extract ONLY these stylometric (writer-identifying) features:

1. LETTER SLANT: Measure the dominant slant angle and its consistency across the sample
2. STROKE WIDTH: Classify as thin, medium, or thick; note variation patterns
3. PEN PRESSURE: Identify pressure patterns — light, medium, heavy, or varied; note where pressure changes occur
4. LETTER SPACING: Classify as cramped, normal, or wide; measure consistency
5. WORD SPACING: Classify as tight, normal, or wide; measure consistency
6. BASELINE: Assess consistency — stable, drifting upward, drifting downward, or wavy
7. HEIGHT RATIO: Measure uppercase-to-lowercase height proportion
8. LOOP FORMATIONS: Describe loop style for letters l, h, b, d, f, g, y — open/closed, round/narrow, size
9. LETTER CONNECTIONS: Describe connection style — fully connected (cursive), disconnected (print), or mixed
10. DISTINCTIVE LETTER FORMATIONS: Analyze specific formation of at least 5 of these letters: a, e, g, o, r, s, d, b, f, l, h — note unique quirks
11. WRITING RHYTHM: Assess overall rhythm and consistency — steady, rushed, deliberate, irregular

ALSO determine if the content is HANDWRITTEN or TYPED/PRINTED. Set is_handwritten to false if typed/printed.

Return ONLY this JSON (no markdown, no extra text):
{
  "letter_formation": {
    "overall_style": "<angular/rounded/mixed>",
    "lowercase_characteristics": "<detailed stylometric description>",
    "uppercase_characteristics": "<detailed stylometric description>",
    "distinctive_letters": {"a": "<rounded/angular/looped/open/closed/simple/mixed>", "e": "<rounded/angular/looped/open/closed/simple/mixed>", "g": "<rounded/angular/looped/open/closed/simple/mixed>", "r": "<rounded/angular/looped/open/closed/simple/mixed>", "t": "<rounded/angular/looped/open/closed/simple/mixed>", "s": "<rounded/angular/looped/open/closed/simple/mixed>"}
  },
  "spacing": {
    "letter_spacing": "<cramped/normal/wide>",
    "word_spacing": "<tight/normal/wide>",
    "spacing_consistency": "<uniform/varied>"
  },
  "stroke_characteristics": {
    "pressure": "<light/medium/heavy/varied>",
    "stroke_width": "<thin/medium/thick/varied>",
    "connections": "<print/cursive/mixed>",
    "pressure_change_pattern": "<description of where pressure varies>"
  },
  "slant_and_baseline": {
    "slant_direction": "<left/vertical/right>",
    "slant_consistency": "<consistent/slightly varied/highly varied>",
    "baseline_behavior": "<stable/ascending/descending/wavy>",
    "height_ratio_upper_lower": "<short/moderate/tall>"
  },
  "unique_identifiers": [
    "<specific biometric feature 1>",
    "<specific biometric feature 2>",
    "<specific biometric feature 3>"
  ],
  "overall_description": "<2-3 sentence stylometric signature summary focusing ONLY on writing mechanics>",
  "confidence_level": <decimal 0 to 1>,
  "is_handwritten": <boolean>
}`;

async function extractPageFeatures(
  pageNumber: number,
  imageBase64: string,
  apiKey: string
): Promise<{ profile: HandwritingProfile | null; is_handwritten: boolean }> {
  console.log(`Extracting features for page ${pageNumber}...`);

  const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
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
  const responseText = aiData.choices?.[0]?.message?.content || '';

  // Clean and parse JSON
  let cleanedText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`Page ${pageNumber}: No JSON found in AI response`);
    return { profile: null, is_handwritten: true };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const is_handwritten = parsed.is_handwritten !== false;
    const profile = normalizeProfile(parsed);
    console.log(`Page ${pageNumber}: extraction ${profile ? 'success' : 'failed normalization'}, handwritten: ${is_handwritten}`);
    return { profile, is_handwritten };
  } catch (err) {
    console.error(`Page ${pageNumber}: JSON parse error:`, err);
    return { profile: null, is_handwritten: true };
  }
}

// ==================== DETERMINISTIC COMPARISON (Stage 2) ====================

function compareProfiles(ref: HandwritingProfile, sub: HandwritingProfile): ComparisonResult {
  let score = 0;
  const matched: string[] = [];
  const mismatched: string[] = [];

  // Slant (15 pts)
  if (ref.slant === sub.slant) { score += 15; matched.push('slant'); }
  else { mismatched.push(`slant (ref:${ref.slant} vs sub:${sub.slant})`); }

  // Stroke Weight (10 pts)
  if (ref.stroke_weight === sub.stroke_weight) { score += 10; matched.push('stroke_weight'); }
  else { mismatched.push(`stroke_weight (ref:${ref.stroke_weight} vs sub:${sub.stroke_weight})`); }

  // Letter Spacing (15 pts)
  if (ref.letter_spacing === sub.letter_spacing) { score += 15; matched.push('letter_spacing'); }
  else { mismatched.push(`letter_spacing (ref:${ref.letter_spacing} vs sub:${sub.letter_spacing})`); }

  // Letter Formations (6 x 5 = 30 pts)
  const letters = ['a', 'e', 'g', 'r', 't', 's'] as const;
  let letterMatches = 0;
  for (const letter of letters) {
    const refVal = ref.letter_formations[letter]?.toLowerCase().trim();
    const subVal = sub.letter_formations[letter]?.toLowerCase().trim();
    if (refVal && subVal && refVal !== "unknown" && subVal !== "unknown" && refVal === subVal) {
      score += 5;
      letterMatches++;
    }
  }
  if (letterMatches > 0) matched.push(`letter_formations (${letterMatches}/6)`);
  if (letterMatches < 6) mismatched.push(`letter_formations (${6 - letterMatches}/6 differ)`);

  // Baseline (10 pts)
  if (ref.baseline === sub.baseline) { score += 10; matched.push('baseline'); }
  else { mismatched.push(`baseline (ref:${ref.baseline} vs sub:${sub.baseline})`); }

  // Height Ratio (10 pts)
  if (ref.height_ratio === sub.height_ratio) { score += 10; matched.push('height_ratio'); }
  else { mismatched.push(`height_ratio (ref:${ref.height_ratio} vs sub:${sub.height_ratio})`); }

  // Writing Style (10 pts)
  if (ref.writing_style === sub.writing_style) { score += 10; matched.push('writing_style'); }
  else { mismatched.push(`writing_style (ref:${ref.writing_style} vs sub:${sub.writing_style})`); }

  const confidence_level = (ref.confidence_level + sub.confidence_level) / 2;

  const key_observations = [
    `Matched: ${matched.join(', ') || 'none'}`,
    `Mismatched: ${mismatched.join(', ') || 'none'}`,
    `Score: ${score}/100`,
  ];

  return {
    similarity_score: score,
    same_writer: score >= 70,
    confidence_level,
    key_observations,
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

    console.log('=== DETERMINISTIC HANDWRITING VERIFICATION START ===');
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
            algorithm_version: '5.0-deterministic',
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
            algorithm_version: '5.0-deterministic',
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

        // Stage 2: Deterministic comparison
        const comparison = compareProfiles(referenceProfile, submissionProfile);
        console.log(`Page ${pageNum} deterministic result:`, comparison);

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
          algorithm_version: '5.0-deterministic',
          page_count: pageResults.length,
          overall_similarity_score: overallSimilarity,
          same_writer: overallSameWriter,
          confidence_level: overallConfidence,
          has_typed_content: hasTypedContent,
          has_different_writer: hasDifferentWriter,
          aggregation_method: 'conservative_minimum',
          page_results: pageResults,
          final_reasoning: finalReasoning,
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
