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
};

function validateProfile(profile: any): boolean {
  for (const field of ['slant', 'stroke_weight', 'letter_spacing', 'word_spacing', 'baseline', 'height_ratio', 'writing_style']) {
    if (!VALID_ENUMS[field].includes(profile[field])) {
      console.error(`Invalid ${field}:`, profile[field]);
      return false;
    }
  }
  const letters = ['a', 'e', 'g', 'r', 't', 's'];
  for (const letter of letters) {
    const shape = profile.letter_formations?.[letter];
    if (shape && !VALID_ENUMS.letter_shape.includes(shape)) {
      console.error(`Invalid shape for letter ${letter}:`, shape);
      return false;
    }
  }
  return true;
}

const EXTRACTION_ATTEMPTS = 3;

function pickMostFrequent<T extends string>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback;

  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let best = fallback;
  let bestCount = -1;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }

  return best;
}

function buildConsensusProfile(profiles: any[]): any {
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
      a: pickMostFrequent(profiles.map((p) => p.letter_formations?.a ?? 'simple'), base.letter_formations?.a ?? 'simple'),
      e: pickMostFrequent(profiles.map((p) => p.letter_formations?.e ?? 'simple'), base.letter_formations?.e ?? 'simple'),
      g: pickMostFrequent(profiles.map((p) => p.letter_formations?.g ?? 'simple'), base.letter_formations?.g ?? 'simple'),
      r: pickMostFrequent(profiles.map((p) => p.letter_formations?.r ?? 'simple'), base.letter_formations?.r ?? 'simple'),
      t: pickMostFrequent(profiles.map((p) => p.letter_formations?.t ?? 'simple'), base.letter_formations?.t ?? 'simple'),
      s: pickMostFrequent(profiles.map((p) => p.letter_formations?.s ?? 'simple'), base.letter_formations?.s ?? 'simple'),
    },
    is_handwritten: true,
    confidence_level: Math.max(0, Math.min(1, profiles.reduce((sum, p) => sum + (p.confidence_level ?? 0.8), 0) / profiles.length)),
  };
}

// ==================== EXTRACTION PROMPT ====================

const EXTRACTION_PROMPT = `You are a forensic handwriting analyst extracting biometric features from a handwriting sample. You MUST return a structured JSON object with EXACT enum values for each feature.

CRITICAL RULES:
1. Use ONLY the exact string values specified below
2. Do NOT use synonyms, descriptions, or variations
3. Return valid JSON without markdown code fences
4. Do NOT include preamble or explanation text

FEATURE EXTRACTION INSTRUCTIONS:

**1. SLANT** — Measure vertical stroke angle relative to baseline
- If strokes lean noticeably left: return EXACTLY "left_lean"
- If strokes lean noticeably right: return EXACTLY "right_lean"
- If strokes are vertical or nearly vertical: return EXACTLY "upright"
Decision rule: Estimate average angle. <80° = left_lean, 80-100° = upright, >100° = right_lean

**2. STROKE_WEIGHT** — Observe line thickness
- If lines are thin and light: return EXACTLY "thin"
- If lines are thick and heavy: return EXACTLY "thick"
- Otherwise: return EXACTLY "medium"
Decision rule: Compare to typical ballpoint pen. Noticeably thinner = thin, noticeably thicker = thick

**3. LETTER_SPACING** — Measure space between letters within words
- If letters touch or nearly touch: return EXACTLY "tight"
- If letters have large gaps (>5mm): return EXACTLY "wide"
- Otherwise: return EXACTLY "normal"

**4. WORD_SPACING** — Measure space between words
- If word gaps are narrow (<8mm): return EXACTLY "tight"
- If word gaps are large (>15mm): return EXACTLY "wide"
- Otherwise: return EXACTLY "normal"

**5. BASELINE** — Observe line alignment
- If writing follows a straight horizontal line: return EXACTLY "straight"
- If writing curves or waves: return EXACTLY "wavy"
- If baseline is inconsistent: return EXACTLY "variable"

**6. HEIGHT_RATIO** — Compare uppercase to lowercase heights
- If uppercase is 2x or taller than lowercase: return EXACTLY "tall"
- If uppercase is 1.3-1.7x lowercase: return EXACTLY "moderate"
- If uppercase barely taller: return EXACTLY "short"

**7. WRITING_STYLE** — Identify connection pattern
- If most letters connect in flowing cursive: return EXACTLY "cursive"
- If letters are separated: return EXACTLY "print"
- If partially connected: return EXACTLY "mixed"

**8. LETTER_FORMATIONS** — For each letter (a, e, g, r, t, s), classify shape:
- Smooth curves dominant: return EXACTLY "rounded"
- Sharp angles dominant: return EXACTLY "angular"
- Has decorative loops: return EXACTLY "looped"
- Open tops/sides: return EXACTLY "open"
- Fully enclosed: return EXACTLY "closed"
- Plain/simple form: return EXACTLY "simple"
- Mixed characteristics: return EXACTLY "mixed"

**9. IS_HANDWRITTEN** — Content type detection
- Handwritten text: return true
- Typed/printed text: return false

**10. CONFIDENCE_LEVEL** — Feature visibility (0.0 to 1.0)
- Clear, well-lit image with distinct features: 0.9
- Slightly blurry or low contrast: 0.7
- Poor quality or unclear features: 0.5

REQUIRED JSON OUTPUT FORMAT (no markdown, no explanation):

{
  "slant": "left_lean",
  "stroke_weight": "medium",
  "letter_spacing": "normal",
  "word_spacing": "normal",
  "baseline": "straight",
  "height_ratio": "moderate",
  "writing_style": "mixed",
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
  console.log('Fetching file:', url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return encode(arrayBuffer);
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, student_details_id } = await req.json();

    console.log('=== HANDWRITING FEATURE EXTRACTION v6.0 START ===');
    console.log('Student details ID:', student_details_id);
    console.log('Image URL:', image_url);

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    if (!image_url || !student_details_id) {
      throw new Error('Missing required parameters: image_url and student_details_id');
    }

    // Fetch image as base64
    const imageBase64 = await fetchFileAsBase64(image_url);
    console.log('Image fetched, base64 length:', imageBase64.length);

    console.log(`Calling Gemini AI for strict enum extraction (${EXTRACTION_ATTEMPTS} attempts)...`);

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
            model: 'google/gemini-2.5-flash',
            temperature: 0,
            top_p: 0.1,
            response_format: { type: 'json_object' },
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
          const errorText = await aiResponse.text();
          console.error('AI Gateway error:', aiResponse.status, errorText);
          if (aiResponse.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
          if (aiResponse.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
          throw new Error(`AI analysis failed: ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        const responseText = aiData.choices?.[0]?.message?.content || '';
        console.log(`Gemini response attempt ${attempt}/${EXTRACTION_ATTEMPTS}, length:`, responseText.length);

        const cleanedText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error(`No JSON found in attempt ${attempt}`);
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.is_handwritten === false) {
          nonHandwrittenVotes++;
        }

        // Validate strict enum values
        if (!validateProfile(parsed)) {
          console.error(`Strict enum validation failed for attempt ${attempt}`);
          continue;
        }

        // Ensure confidence_level is a number in range
        if (typeof parsed.confidence_level !== 'number') {
          parsed.confidence_level = 0.5;
        } else {
          parsed.confidence_level = Math.max(0, Math.min(1, parsed.confidence_level));
        }

        extractedProfiles.push(parsed);
        console.log(`Extraction attempt ${attempt}/${EXTRACTION_ATTEMPTS} succeeded`);
      } catch (attemptError) {
        console.error(`Extraction attempt ${attempt}/${EXTRACTION_ATTEMPTS} failed:`, attemptError);
      }
    }

    if (nonHandwrittenVotes >= 2) {
      throw new Error('Uploaded sample appears typed/printed instead of handwritten');
    }

    if (extractedProfiles.length === 0) {
      throw new Error('Failed to create handwriting profile from image');
    }

    const handwritingProfile = extractedProfiles.length === 1
      ? extractedProfiles[0]
      : buildConsensusProfile(extractedProfiles);

    // Add metadata
    handwritingProfile.version = '6.0-weighted';
    handwritingProfile.trained_at = new Date().toISOString();
    handwritingProfile.reference_image_url = image_url;

    console.log(`Built profile consensus from ${extractedProfiles.length}/${EXTRACTION_ATTEMPTS} successful attempts`);
    console.log('Validated handwriting profile:', JSON.stringify(handwritingProfile, null, 2));

    // Create Supabase client and update student_details
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error: updateError } = await supabase
      .from('student_details')
      .update({
        handwriting_feature_embedding: handwritingProfile,
        handwriting_features_extracted_at: new Date().toISOString(),
      })
      .eq('id', student_details_id);

    if (updateError) {
      console.error('Error updating student details:', updateError);
      throw new Error('Failed to save handwriting profile');
    }

    console.log('=== HANDWRITING FEATURE EXTRACTION v6.0 COMPLETE ===');

    return new Response(JSON.stringify({
      success: true,
      message: 'Handwriting profile created successfully with strict enum validation',
      profile_version: '6.0-weighted',
      features_validated: true,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in extract-handwriting-features:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
