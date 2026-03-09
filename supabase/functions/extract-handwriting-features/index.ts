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

// ==================== TOOL CALLING SCHEMA ====================

const EXTRACTION_TOOL = {
  type: "function" as const,
  function: {
    name: "report_handwriting_features",
    description: "Report the extracted handwriting features from the analyzed image.",
    parameters: {
      type: "object",
      properties: {
        slant: {
          type: "string",
          enum: ["left_lean", "right_lean", "upright"],
          description: "Vertical stroke angle: left_lean (<85°), upright (85-95°), right_lean (>95°)"
        },
        stroke_weight: {
          type: "string",
          enum: ["thin", "medium", "thick"],
          description: "Line thickness compared to standard ballpoint pen"
        },
        letter_spacing: {
          type: "string",
          enum: ["tight", "normal", "wide"],
          description: "Space between letters within words"
        },
        word_spacing: {
          type: "string",
          enum: ["tight", "normal", "wide"],
          description: "Space between words"
        },
        baseline: {
          type: "string",
          enum: ["straight", "wavy", "variable"],
          description: "Line alignment consistency"
        },
        height_ratio: {
          type: "string",
          enum: ["short", "moderate", "tall"],
          description: "Uppercase to lowercase height ratio"
        },
        writing_style: {
          type: "string",
          enum: ["cursive", "print", "mixed"],
          description: "Letter connection pattern"
        },
        letter_a: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_e: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_g: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_r: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_t: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        letter_s: { type: "string", enum: ["rounded", "angular", "looped", "open", "closed", "simple", "mixed"] },
        is_handwritten: {
          type: "boolean",
          description: "true if content is handwritten, false if typed/printed"
        },
        confidence_level: {
          type: "number",
          description: "Feature visibility quality from 0.0 to 1.0. Clear=0.9, blurry=0.7, poor=0.5"
        }
      },
      required: ["slant", "stroke_weight", "letter_spacing", "word_spacing", "baseline", "height_ratio", "writing_style", "letter_a", "letter_e", "letter_g", "letter_r", "letter_t", "letter_s", "is_handwritten", "confidence_level"],
      additionalProperties: false
    }
  }
};

const SYSTEM_PROMPT = `You are a forensic handwriting analyst. Analyze the handwriting image and extract biometric features using the report_handwriting_features tool.

ANALYSIS RULES:
- SLANT: Measure average vertical stroke angle. <85° = left_lean, 85-95° = upright, >95° = right_lean
- STROKE_WEIGHT: Compare line thickness to standard ballpoint pen. Noticeably thinner = thin, thicker = thick
- LETTER_SPACING: Letters touching/nearly touching = tight, large gaps = wide
- WORD_SPACING: Word gaps narrow (<8mm) = tight, large (>15mm) = wide
- BASELINE: Follows straight line = straight, curves/waves = wavy, inconsistent = variable
- HEIGHT_RATIO: Uppercase 2x+ taller = tall, 1.3-1.7x = moderate, barely taller = short
- WRITING_STYLE: Most letters connect = cursive, separated = print, partial = mixed
- LETTER SHAPES: For each letter (a,e,g,r,t,s): rounded (smooth curves), angular (sharp), looped (decorative loops), open (open tops/sides), closed (fully enclosed), simple (plain), mixed
- IS_HANDWRITTEN: true for handwritten, false for typed/printed
- CONFIDENCE: 0.9 for clear images, 0.7 for slightly blurry, 0.5 for poor quality`;

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

function toolCallToProfile(args: any): any {
  return {
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
    is_handwritten: args.is_handwritten,
    confidence_level: typeof args.confidence_level === 'number'
      ? Math.max(0, Math.min(1, args.confidence_level))
      : 0.5,
  };
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, student_details_id } = await req.json();

    console.log('=== HANDWRITING FEATURE EXTRACTION v7.0-toolcall START ===');
    console.log('Student details ID:', student_details_id);
    console.log('Image URL:', image_url);

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    if (!image_url || !student_details_id) {
      throw new Error('Missing required parameters: image_url and student_details_id');
    }

    const imageBase64 = await fetchFileAsBase64(image_url);
    console.log('Image fetched, base64 length:', imageBase64.length);

    console.log(`Calling AI with tool calling for strict enum extraction (${EXTRACTION_ATTEMPTS} attempts)...`);

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
            tools: [EXTRACTION_TOOL],
            tool_choice: { type: "function", function: { name: "report_handwriting_features" } },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
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
          const errorText = await aiResponse.text();
          console.error('AI Gateway error:', aiResponse.status, errorText);
          if (aiResponse.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
          if (aiResponse.status === 402) throw new Error('AI credits exhausted. Please add credits to continue.');
          throw new Error(`AI analysis failed: ${aiResponse.status}`);
        }

        const aiData = await aiResponse.json();
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

        if (!toolCall || toolCall.function.name !== 'report_handwriting_features') {
          // Fallback: try parsing content as JSON
          const content = aiData.choices?.[0]?.message?.content || '';
          console.warn(`Attempt ${attempt}: No tool call returned, trying JSON fallback. Content length: ${content.length}`);
          const jsonMatch = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim().match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.is_handwritten === false) nonHandwrittenVotes++;
            if (validateProfile(parsed)) {
              if (typeof parsed.confidence_level !== 'number') parsed.confidence_level = 0.5;
              else parsed.confidence_level = Math.max(0, Math.min(1, parsed.confidence_level));
              extractedProfiles.push(parsed);
              console.log(`Attempt ${attempt}: JSON fallback succeeded`);
            }
          }
          continue;
        }

        const args = typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;

        console.log(`Attempt ${attempt}: Tool call args:`, JSON.stringify(args));

        const profile = toolCallToProfile(args);

        if (profile.is_handwritten === false) {
          nonHandwrittenVotes++;
        }

        if (!validateProfile(profile)) {
          console.error(`Attempt ${attempt}: validation failed despite tool calling`);
          continue;
        }

        extractedProfiles.push(profile);
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
    handwritingProfile.version = '7.0-toolcall';
    handwritingProfile.trained_at = new Date().toISOString();
    handwritingProfile.reference_image_url = image_url;

    console.log(`Built profile consensus from ${extractedProfiles.length}/${EXTRACTION_ATTEMPTS} successful attempts`);
    console.log('Validated handwriting profile:', JSON.stringify(handwritingProfile, null, 2));

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

    console.log('=== HANDWRITING FEATURE EXTRACTION v7.0-toolcall COMPLETE ===');

    return new Response(JSON.stringify({
      success: true,
      message: 'Handwriting profile created with tool-call enforced enums',
      profile_version: '7.0-toolcall',
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
