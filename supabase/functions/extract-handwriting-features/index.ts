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

// This function trains Gemini to learn a student's unique handwriting style
// by analyzing their reference sample and storing a detailed profile

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

    console.log('=== GEMINI HANDWRITING TRAINING START ===');
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

    // Build the prompt for Gemini to deeply learn this student's handwriting
    const trainingPrompt = `You are a FORENSIC DOCUMENT EXAMINER creating a biometric writer profile for writer identification purposes.

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

Return ONLY this JSON (no markdown, no extra text):
{
  "letter_formation": {
    "overall_style": "<angular/rounded/mixed>",
    "lowercase_characteristics": "<detailed stylometric description>",
    "uppercase_characteristics": "<detailed stylometric description>",
    "distinctive_letters": {"<letter>": "<formation description>", ...for at least 5 letters}
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
    "height_ratio_upper_lower": "<ratio description>"
  },
  "unique_identifiers": [
    "<specific biometric feature 1>",
    "<specific biometric feature 2>",
    "<specific biometric feature 3>",
    "<specific biometric feature 4>",
    "<specific biometric feature 5>"
  ],
  "overall_description": "<2-3 sentence stylometric signature summary focusing ONLY on writing mechanics>",
  "confidence_level": <decimal 0 to 1>
}`;

    console.log('Calling Gemini AI to learn handwriting style...');

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
              { type: 'text', text: trainingPrompt },
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
    console.log('Gemini training response received');

    // Parse the handwriting profile
    let handwritingProfile: any;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      handwritingProfile = JSON.parse(jsonMatch[0]);
      
      // Validate required fields exist
      if (!handwritingProfile.letter_formation || !handwritingProfile.unique_identifiers) {
        throw new Error('Missing required profile fields');
      }

      // Add metadata
      handwritingProfile.version = '3.0-gemini-trained';
      handwritingProfile.trained_at = new Date().toISOString();
      handwritingProfile.reference_image_url = image_url;

    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.log('Raw response:', responseText);
      throw new Error('Failed to create handwriting profile from image');
    }

    console.log('Handwriting profile created:', JSON.stringify(handwritingProfile, null, 2));

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

    console.log('=== GEMINI HANDWRITING TRAINING COMPLETE ===');

    return new Response(JSON.stringify({
      success: true,
      message: 'Handwriting profile created successfully',
      profile_version: '3.0-gemini-trained',
      unique_identifiers_count: handwritingProfile.unique_identifiers?.length || 0,
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
