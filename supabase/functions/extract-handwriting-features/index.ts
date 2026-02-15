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
    console.log('Image URL provided:', !!image_url);

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    if (!image_url || !student_details_id) {
      throw new Error('Missing required parameters: image_url and student_details_id');
    }

    // CRITICAL: Verify student_details_id exists and fetch for validation
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { data: studentDetails, error: detailsError } = await supabase
      .from('student_details')
      .select('id, profile_id')
      .eq('id', student_details_id)
      .single();

    if (detailsError || !studentDetails) {
      console.error('Error verifying student details:', detailsError);
      throw new Error('Invalid student_details_id');
    }

    console.log('Verified student details for profile:', studentDetails.profile_id);

    // Fetch image as base64
    const imageBase64 = await fetchFileAsBase64(image_url);
    console.log('Image fetched, size:', imageBase64.length);

    // Build the prompt for Gemini to deeply learn this student's handwriting
    const trainingPrompt = `You are a forensic handwriting expert. Analyze this handwriting sample and create a DETAILED PROFILE of this specific person's handwriting style. This profile will be used to verify their identity in future document submissions.

STUDY THIS HANDWRITING SAMPLE CAREFULLY AND EXTRACT:

## 1. LETTER FORMATION CHARACTERISTICS
- How does this person form each letter? (round, angular, loopy, pointed)
- Specific quirks in letter shapes (e.g., open or closed 'a', rounded or pointed 'm')
- How they write numbers (if visible)
- Capital letter style vs lowercase
- Any unique letter formations that stand out

## 2. SPACING AND LAYOUT
- Letter spacing (tight, normal, wide)
- Word spacing pattern
- Line spacing
- Margins and text positioning
- How do they use the page?

## 3. STROKE CHARACTERISTICS
- Pen pressure patterns (heavy, light, varied)
- Stroke direction preferences
- Beginning and ending strokes of letters
- Connections between letters (cursive, print, mixed)
- Stroke thickness consistency

## 4. SLANT AND BASELINE
- Overall slant direction and degree (left, vertical, right)
- Baseline consistency (straight, wavy, ascending, descending)
- Letter size consistency (uniform or varied)

## 5. UNIQUE IDENTIFIERS
- List 5-10 SPECIFIC, UNIQUE characteristics that make this handwriting identifiable
- These should be features that would be hard to replicate
- Include any distinctive quirks, flourishes, or unusual patterns

## 6. OVERALL STYLE DESCRIPTION
- A paragraph describing the general impression of this handwriting
- Is it neat, messy, rushed, careful, artistic, mechanical?

RESPOND WITH ONLY THIS JSON (no markdown, no extra text):
{
  "letter_formation": {
    "overall_style": "<description>",
    "lowercase_characteristics": "<detailed description>",
    "uppercase_characteristics": "<detailed description>",
    "number_style": "<if visible, describe>",
    "unique_letter_quirks": ["<quirk1>", "<quirk2>", "..."]
  },
  "spacing": {
    "letter_spacing": "<tight/normal/wide>",
    "word_spacing": "<tight/normal/wide>",
    "line_spacing": "<tight/normal/wide>",
    "overall_density": "<cramped/balanced/spacious>"
  },
  "stroke_characteristics": {
    "pressure": "<light/medium/heavy/varied>",
    "connections": "<print/cursive/mixed>",
    "stroke_thickness": "<thin/medium/thick/varied>",
    "stroke_smoothness": "<smooth/angular/mixed>"
  },
  "slant_and_baseline": {
    "slant_direction": "<left/vertical/right>",
    "slant_degree": "<slight/moderate/strong>",
    "baseline_consistency": "<stable/slightly wavy/wavy/ascending/descending>",
    "size_consistency": "<uniform/slightly varied/highly varied>"
  },
  "unique_identifiers": [
    "<specific unique characteristic 1>",
    "<specific unique characteristic 2>",
    "<specific unique characteristic 3>",
    "<specific unique characteristic 4>",
    "<specific unique characteristic 5>"
  ],
  "overall_description": "<2-3 sentence description of this person's handwriting style>",
  "confidence_level": "<high/medium/low - based on sample quality>"
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
    let handwritingProfile: Record<string, unknown>;
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

    // Update student_details - STRICTLY for this student only
    const { error: updateError } = await supabase
      .from('student_details')
      .update({
        handwriting_feature_embedding: handwritingProfile,
        handwriting_features_extracted_at: new Date().toISOString(),
      })
      .eq('id', student_details_id)
      .eq('profile_id', studentDetails.profile_id); // CRITICAL: Double-check ownership

    if (updateError) {
      console.error('Error updating student details:', updateError);
      throw new Error('Failed to save handwriting profile');
    }

    console.log('=== GEMINI HANDWRITING TRAINING COMPLETE for profile:', studentDetails.profile_id);

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
