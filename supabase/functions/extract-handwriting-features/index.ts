import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface HandwritingFeatures {
  slant_angle: number;
  stroke_width: number;
  letter_height_ratio: number;
  inter_letter_spacing: number;
  inter_word_spacing: number;
  baseline_stability: number;
  letter_roundness: number;
  connection_style: number;
  pressure_variation: number;
  character_consistency: number;
}

async function fetchFileAsBase64(url: string): Promise<string> {
  console.log('Fetching file:', url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return encode(arrayBuffer);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, student_details_id } = await req.json();

    console.log('=== FEATURE EXTRACTION START ===');
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
    console.log('Image fetched, size:', imageBase64.length);

    // Build the prompt for feature extraction
    const extractionPrompt = `You are an expert forensic document examiner specializing in handwriting analysis. 
Your task is to analyze this handwriting sample and extract precise numerical features that characterize this writer's unique style.

The sample should contain handwritten text (letters, numbers, sentences).

ANALYZE THE HANDWRITING AND EXTRACT THESE 10 FEATURES:

1. **slant_angle** (-45 to +45 degrees)
   - Negative = leftward slant
   - 0 = vertical
   - Positive = rightward slant
   - Measure the average angle of vertical strokes from true vertical

2. **stroke_width** (1-10)
   - 1 = very thin/light strokes
   - 10 = very thick/heavy strokes

3. **letter_height_ratio** (0.3-0.9)
   - Ratio of x-height to total letter height
   - 0.5 = x-height is half the total height

4. **inter_letter_spacing** (1-10)
   - 1 = letters very close together
   - 10 = letters very spread out

5. **inter_word_spacing** (1-10)
   - 1 = words very close together
   - 10 = words very spread out

6. **baseline_stability** (1-10)
   - 1 = very wavy, inconsistent baseline
   - 10 = perfectly straight baseline

7. **letter_roundness** (1-10)
   - 1 = very angular, sharp letters
   - 10 = very round, curved letters

8. **connection_style** (0-100)
   - 0 = completely print style (no connections)
   - 100 = completely cursive (all letters connected)

9. **pressure_variation** (1-10)
   - 1 = very consistent pressure throughout
   - 10 = highly varied pressure (thick and thin strokes)

10. **character_consistency** (1-10)
    - 1 = same letters look very different each time
    - 10 = same letters look identical each time

RESPOND WITH ONLY THIS JSON (no markdown, no extra text):
{
  "slant_angle": <number>,
  "stroke_width": <number>,
  "letter_height_ratio": <number>,
  "inter_letter_spacing": <number>,
  "inter_word_spacing": <number>,
  "baseline_stability": <number>,
  "letter_roundness": <number>,
  "connection_style": <number>,
  "pressure_variation": <number>,
  "character_consistency": <number>
}

Be precise and consistent. These features will be used to verify the writer's identity in future submissions.`;

    console.log('Calling Lovable AI for feature extraction...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
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
      
      if (aiResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted. Please add credits to continue.');
      }
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const responseText = aiData.choices?.[0]?.message?.content || '';
    console.log('AI Response received');

    // Parse the features
    let features: HandwritingFeatures;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      features = JSON.parse(jsonMatch[0]);
      
      // Validate all required fields exist
      const requiredFields = [
        'slant_angle', 'stroke_width', 'letter_height_ratio',
        'inter_letter_spacing', 'inter_word_spacing', 'baseline_stability',
        'letter_roundness', 'connection_style', 'pressure_variation', 'character_consistency'
      ];
      
      for (const field of requiredFields) {
        if (typeof (features as any)[field] !== 'number') {
          throw new Error(`Missing or invalid field: ${field}`);
        }
      }

      // Clamp values to valid ranges
      features.slant_angle = Math.max(-45, Math.min(45, features.slant_angle));
      features.stroke_width = Math.max(1, Math.min(10, features.stroke_width));
      features.letter_height_ratio = Math.max(0.3, Math.min(0.9, features.letter_height_ratio));
      features.inter_letter_spacing = Math.max(1, Math.min(10, features.inter_letter_spacing));
      features.inter_word_spacing = Math.max(1, Math.min(10, features.inter_word_spacing));
      features.baseline_stability = Math.max(1, Math.min(10, features.baseline_stability));
      features.letter_roundness = Math.max(1, Math.min(10, features.letter_roundness));
      features.connection_style = Math.max(0, Math.min(100, features.connection_style));
      features.pressure_variation = Math.max(1, Math.min(10, features.pressure_variation));
      features.character_consistency = Math.max(1, Math.min(10, features.character_consistency));

    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.log('Raw response:', responseText);
      throw new Error('Failed to extract handwriting features from image');
    }

    console.log('Extracted features:', features);

    // Create Supabase client and update student_details
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error: updateError } = await supabase
      .from('student_details')
      .update({
        handwriting_feature_embedding: features,
        handwriting_features_extracted_at: new Date().toISOString(),
      })
      .eq('id', student_details_id);

    if (updateError) {
      console.error('Error updating student details:', updateError);
      throw new Error('Failed to save handwriting features');
    }

    console.log('=== FEATURE EXTRACTION COMPLETE ===');

    return new Response(JSON.stringify({
      success: true,
      features,
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
