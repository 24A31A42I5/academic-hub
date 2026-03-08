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
  pen_pressure: ['light', 'medium', 'heavy'],
  line_quality: ['smooth', 'shaky', 'variable'],
  size_consistency: ['uniform', 'variable', 'decreasing'],
  t_cross_position: ['low', 'middle', 'high'],
  i_dot_style: ['round', 'dash', 'absent', 'circle'],
};

const CORE_FIELDS = ['slant', 'stroke_weight', 'letter_spacing', 'word_spacing', 'baseline', 'height_ratio', 'writing_style'];
const EXTENDED_FIELDS = ['pen_pressure', 'line_quality', 'size_consistency', 't_cross_position', 'i_dot_style'];
const LETTERS = ['a', 'e', 'g', 'r', 't', 's'] as const;

function validateProfile(profile: any): boolean {
  for (const field of CORE_FIELDS) {
    if (!VALID_ENUMS[field]?.includes(profile[field])) {
      console.error(`Invalid ${field}:`, profile[field]);
      return false;
    }
  }
  for (const field of EXTENDED_FIELDS) {
    if (profile[field] && !VALID_ENUMS[field]?.includes(profile[field])) {
      console.error(`Invalid extended ${field}:`, profile[field]);
      return false;
    }
  }
  for (const letter of LETTERS) {
    const shape = profile.letter_formations?.[letter];
    if (shape && !VALID_ENUMS.letter_shape.includes(shape)) {
      console.error(`Invalid shape for letter ${letter}:`, shape);
      return false;
    }
  }
  return true;
}

const EXTRACTION_ATTEMPTS = 3;

function pickMostFrequent<T extends string>(values: (T | undefined | null)[], fallback: T): T {
  const filtered = values.filter((v): v is T => v != null);
  if (filtered.length === 0) return fallback;
  const counts = new Map<T, number>();
  for (const v of filtered) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = fallback, bestCount = -1;
  for (const [v, c] of counts) { if (c > bestCount) { best = v; bestCount = c; } }
  return best;
}

function buildConsensusProfile(profiles: any[]): any {
  const base = profiles[0];
  const result: any = {};

  for (const f of CORE_FIELDS) {
    result[f] = pickMostFrequent(profiles.map(p => p[f]), base[f]);
  }
  for (const f of EXTENDED_FIELDS) {
    result[f] = pickMostFrequent(profiles.map(p => p[f]), base[f] ?? null);
  }

  result.letter_formations = {};
  for (const l of LETTERS) {
    result.letter_formations[l] = pickMostFrequent(
      profiles.map(p => p.letter_formations?.[l] ?? 'simple'),
      base.letter_formations?.[l] ?? 'simple'
    );
  }

  result.is_handwritten = true;
  result.confidence_level = Math.max(0, Math.min(1,
    profiles.reduce((sum: number, p: any) => sum + (p.confidence_level ?? 0.8), 0) / profiles.length
  ));

  return result;
}

// ==================== v7.0 ENHANCED EXTRACTION PROMPT ====================

const EXTRACTION_PROMPT = `You are an expert forensic document examiner performing questioned document analysis. Extract ALL biometric handwriting features from this sample with extreme precision. Return ONLY a JSON object with EXACT enum values.

CRITICAL: Use ONLY the exact values listed. NO synonyms, NO descriptions.

=== PRIMARY STYLOMETRIC FEATURES ===

1. SLANT — Vertical stroke angle vs baseline
   "left_lean" = strokes tilt left (<80°)
   "right_lean" = strokes tilt right (>100°)
   "upright" = vertical (80-100°)

2. STROKE_WEIGHT — Line thickness/pressure
   "thin" = light, fine lines
   "medium" = standard ballpoint width
   "thick" = heavy, bold lines

3. LETTER_SPACING — Space between letters within words
   "tight" = letters touch/overlap
   "normal" = standard separation
   "wide" = large gaps between letters

4. WORD_SPACING — Space between words
   "tight" = narrow word gaps
   "normal" = standard word gaps
   "wide" = large word gaps

5. BASELINE — Writing line alignment
   "straight" = follows straight line
   "wavy" = oscillates up/down
   "variable" = inconsistent/drifting

6. HEIGHT_RATIO — Uppercase to lowercase height ratio
   "short" = uppercase barely taller (1.0-1.3x)
   "moderate" = uppercase 1.3-1.7x taller
   "tall" = uppercase 2x+ taller

7. WRITING_STYLE — Letter connection pattern
   "cursive" = most letters connected, flowing
   "print" = letters separated, block style
   "mixed" = partially connected

=== ADVANCED BIOMETRIC FEATURES ===

8. PEN_PRESSURE — Overall writing pressure
   "light" = faint, delicate strokes
   "medium" = normal pressure
   "heavy" = deep, dark impressions

9. LINE_QUALITY — Stroke smoothness
   "smooth" = clean, fluid strokes
   "shaky" = tremulous, unsteady lines
   "variable" = mixed smooth and shaky

10. SIZE_CONSISTENCY — Letter size uniformity across sample
    "uniform" = consistent letter sizes throughout
    "variable" = moderate size variation
    "decreasing" = letters get smaller toward line end

11. T_CROSS_POSITION — Where the horizontal bar crosses the 't' stem
    "low" = bar crosses in lower third
    "middle" = bar crosses at midpoint
    "high" = bar crosses in upper third or above

12. I_DOT_STYLE — Shape/style of dot on letter 'i'
    "round" = circular dot
    "dash" = short horizontal stroke
    "absent" = no dot visible
    "circle" = open circle/bubble

=== LETTER FORMATIONS ===

13. For EACH letter (a, e, g, r, t, s), classify its dominant shape:
    "rounded" = smooth curves
    "angular" = sharp angles/corners
    "looped" = decorative loops
    "open" = open tops/gaps
    "closed" = fully enclosed
    "simple" = plain/basic form
    "mixed" = multiple characteristics

14. IS_HANDWRITTEN — true if handwritten, false if typed/printed
15. CONFIDENCE_LEVEL — Image quality score 0.0-1.0

RETURN THIS EXACT JSON STRUCTURE:
{
  "slant": "upright",
  "stroke_weight": "medium",
  "letter_spacing": "normal",
  "word_spacing": "normal",
  "baseline": "straight",
  "height_ratio": "moderate",
  "writing_style": "mixed",
  "pen_pressure": "medium",
  "line_quality": "smooth",
  "size_consistency": "uniform",
  "t_cross_position": "middle",
  "i_dot_style": "round",
  "letter_formations": {
    "a": "rounded",
    "e": "open",
    "g": "looped",
    "r": "angular",
    "t": "simple",
    "s": "closed"
  },
  "is_handwritten": true,
  "confidence_level": 0.9
}`;

// ==================== HELPERS ====================

async function fetchFileAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
  return encode(await response.arrayBuffer());
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, student_details_id } = await req.json();

    console.log('=== HANDWRITING FEATURE EXTRACTION v7.0 START ===');
    console.log('Student details ID:', student_details_id);

    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    if (!image_url || !student_details_id) throw new Error('Missing required parameters');

    const imageBase64 = await fetchFileAsBase64(image_url);
    console.log('Image fetched, base64 length:', imageBase64.length);

    const extractedProfiles: any[] = [];
    let nonHandwrittenVotes = 0;

    for (let attempt = 1; attempt <= EXTRACTION_ATTEMPTS; attempt++) {
      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-pro',
            temperature: 0,
            top_p: 0.1,
            response_format: { type: 'json_object' },
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: EXTRACTION_PROMPT },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
              ]
            }],
          }),
        });

        if (!aiResponse.ok) {
          const status = aiResponse.status;
          const errorText = await aiResponse.text();
          console.error(`AI Gateway error (attempt ${attempt}):`, status, errorText);
          if (status === 429) throw new Error('Rate limit exceeded. Please try again later.');
          if (status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
          throw new Error(`AI analysis failed: ${status}`);
        }

        const aiData = await aiResponse.json();
        const responseText = aiData.choices?.[0]?.message?.content || '';
        const cleanedText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) { console.error(`No JSON in attempt ${attempt}`); continue; }

        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.is_handwritten === false) nonHandwrittenVotes++;

        if (!validateProfile(parsed)) {
          console.error(`Validation failed attempt ${attempt}`);
          continue;
        }

        if (typeof parsed.confidence_level !== 'number') parsed.confidence_level = 0.5;
        else parsed.confidence_level = Math.max(0, Math.min(1, parsed.confidence_level));

        extractedProfiles.push(parsed);
        console.log(`Attempt ${attempt}/${EXTRACTION_ATTEMPTS} succeeded`);
      } catch (attemptError) {
        console.error(`Attempt ${attempt} failed:`, attemptError);
        if ((attemptError as Error).message?.includes('Rate limit') || (attemptError as Error).message?.includes('credits')) throw attemptError;
      }
    }

    if (nonHandwrittenVotes >= 2) throw new Error('Uploaded sample appears typed/printed instead of handwritten');
    if (extractedProfiles.length === 0) throw new Error('Failed to create handwriting profile from image');

    const handwritingProfile = extractedProfiles.length === 1
      ? extractedProfiles[0]
      : buildConsensusProfile(extractedProfiles);

    handwritingProfile.version = '7.0-enhanced';
    handwritingProfile.trained_at = new Date().toISOString();
    handwritingProfile.reference_image_url = image_url;
    handwritingProfile.feature_count = CORE_FIELDS.length + EXTENDED_FIELDS.length + LETTERS.length;

    console.log(`Consensus from ${extractedProfiles.length}/${EXTRACTION_ATTEMPTS} attempts`);
    console.log('Profile:', JSON.stringify(handwritingProfile, null, 2));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: updateError } = await supabase
      .from('student_details')
      .update({
        handwriting_feature_embedding: handwritingProfile,
        handwriting_features_extracted_at: new Date().toISOString(),
      })
      .eq('id', student_details_id);

    if (updateError) throw new Error('Failed to save handwriting profile');

    console.log('=== EXTRACTION v7.0 COMPLETE ===');

    return new Response(JSON.stringify({
      success: true,
      message: 'Handwriting profile created with v7.0 enhanced biometrics',
      profile_version: '7.0-enhanced',
      features_extracted: handwritingProfile.feature_count,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
