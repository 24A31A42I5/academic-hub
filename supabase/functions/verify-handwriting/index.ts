import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface VerificationResult {
  similarity_score: number;
  confidence_score: number;
  risk_level: 'low' | 'medium' | 'high';
  analysis_details: {
    letter_formation: { match: boolean; notes: string };
    slant_angle: { match: boolean; notes: string };
    spacing: { match: boolean; notes: string };
    baseline: { match: boolean; notes: string };
    unique_features: { match: boolean; notes: string };
  };
  overall_conclusion: string;
  flagged_concerns: string[];
}

async function fetchFileAsBase64(url: string): Promise<string> {
  console.log('Fetching file:', url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

function getMimeType(url: string, fileType?: string): string {
  if (fileType) {
    if (fileType.includes('pdf')) return 'application/pdf';
    if (fileType.includes('image')) return fileType;
    if (fileType.includes('doc')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  
  const ext = url.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'doc': return 'application/msword';
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default: return 'application/octet-stream';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submission_id, file_url, file_type, student_profile_id } = await req.json();
    
    console.log('Starting handwriting verification for submission:', submission_id);
    console.log('File URL:', file_url);
    console.log('File Type:', file_type);
    console.log('Student Profile ID:', student_profile_id);

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Create Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch student's reference handwriting
    const { data: studentDetails, error: studentError } = await supabase
      .from('student_details')
      .select('handwriting_url, profile_id')
      .eq('profile_id', student_profile_id)
      .single();

    if (studentError) {
      console.error('Error fetching student details:', studentError);
      throw new Error('Failed to fetch student details');
    }

    if (!studentDetails?.handwriting_url) {
      console.log('No handwriting sample found for student');
      // Update submission with unverified status
      await supabase
        .from('submissions')
        .update({
          ai_risk_level: 'unverified',
          ai_analysis_details: { error: 'No handwriting sample uploaded by student' },
          verified_at: new Date().toISOString(),
        })
        .eq('id', submission_id);
      
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'No handwriting sample found for student' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Reference handwriting URL:', studentDetails.handwriting_url);

    // Fetch both files as base64
    const [referenceBase64, submissionBase64] = await Promise.all([
      fetchFileAsBase64(studentDetails.handwriting_url),
      fetchFileAsBase64(file_url),
    ]);

    const referenceMimeType = getMimeType(studentDetails.handwriting_url);
    const submissionMimeType = getMimeType(file_url, file_type);

    console.log('Reference MIME type:', referenceMimeType);
    console.log('Submission MIME type:', submissionMimeType);

    // Build the message content based on file types
    const content: any[] = [
      {
        type: 'text',
        text: `You are a forensic handwriting analysis expert with years of experience in document examination and writer identification. Your task is to compare two handwriting samples and determine if they were written by the same person.

IMPORTANT: You are comparing a REFERENCE handwriting sample (Image 1) that was submitted by a student as their authentic handwriting, against an ASSIGNMENT submission (Image 2 or Document) that the student claims to have written themselves.

Analyze the following characteristics carefully:

1. **Letter Formation Consistency**: Compare how specific letters are formed (a, e, g, o, r, s, t, etc.). Look for consistent loops, curves, and strokes.

2. **Writing Slant and Angle**: Measure the angle of the writing. Is it consistently left-leaning, right-leaning, or vertical in both samples?

3. **Letter and Word Spacing**: Compare the spacing patterns between letters and words.

4. **Baseline Consistency**: Is the writing on a consistent baseline? Does it tend to slope up or down?

5. **Letter Size Proportions**: Compare the relative sizes of letters, especially the ratio between uppercase and lowercase.

6. **Pen Pressure Patterns**: Look for consistent pressure patterns (heavy vs. light strokes).

7. **Unique Character Formations**: Identify any distinctive personal characteristics in letter formation that could serve as identifiers.

8. **Writing Speed Indicators**: Look for signs of writing speed (smooth vs. hesitant strokes).

CRITICAL: Provide your analysis in EXACTLY this JSON format (no additional text before or after):

{
  "similarity_score": <number 0-100>,
  "confidence_score": <number 0-100>,
  "risk_level": "<'low' | 'medium' | 'high'>",
  "analysis_details": {
    "letter_formation": { "match": <boolean>, "notes": "<detailed observation>" },
    "slant_angle": { "match": <boolean>, "notes": "<detailed observation>" },
    "spacing": { "match": <boolean>, "notes": "<detailed observation>" },
    "baseline": { "match": <boolean>, "notes": "<detailed observation>" },
    "unique_features": { "match": <boolean>, "notes": "<detailed observation>" }
  },
  "overall_conclusion": "<2-3 sentence professional assessment>",
  "flagged_concerns": ["<specific concern 1>", "<specific concern 2>"]
}

Guidelines for scoring:
- similarity_score 80-100: Very likely same writer (low risk)
- similarity_score 50-79: Uncertain, requires human review (medium risk)
- similarity_score 0-49: Likely different writer (high risk)

- risk_level "low": similarity_score >= 70
- risk_level "medium": similarity_score 40-69
- risk_level "high": similarity_score < 40

If the document is typed/printed rather than handwritten, set similarity_score to 0 and add "Document appears to be typed/printed, not handwritten" to flagged_concerns.`
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:${referenceMimeType};base64,${referenceBase64}`
        }
      }
    ];

    // Add submission file - for PDFs, Gemini can handle them directly
    if (submissionMimeType === 'application/pdf') {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:application/pdf;base64,${submissionBase64}`
        }
      });
    } else if (submissionMimeType.startsWith('image/')) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${submissionMimeType};base64,${submissionBase64}`
        }
      });
    } else {
      // For DOC/DOCX, we'll note this limitation
      content.push({
        type: 'text',
        text: 'Note: The submission is a Word document. Please analyze any visible handwriting or note if the document appears to be typed.'
      });
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${submissionMimeType};base64,${submissionBase64}`
        }
      });
    }

    console.log('Calling Lovable AI for analysis...');

    // Call Lovable AI with Gemini 2.5 Pro for vision capabilities
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'user',
            content: content
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
    console.log('AI Response received');

    const responseText = aiData.choices?.[0]?.message?.content || '';
    console.log('Raw AI response:', responseText);

    // Parse the JSON response
    let verificationResult: VerificationResult;
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      verificationResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      // Create a fallback response
      verificationResult = {
        similarity_score: 50,
        confidence_score: 30,
        risk_level: 'medium',
        analysis_details: {
          letter_formation: { match: false, notes: 'Unable to parse detailed analysis' },
          slant_angle: { match: false, notes: 'Unable to parse detailed analysis' },
          spacing: { match: false, notes: 'Unable to parse detailed analysis' },
          baseline: { match: false, notes: 'Unable to parse detailed analysis' },
          unique_features: { match: false, notes: 'Unable to parse detailed analysis' },
        },
        overall_conclusion: 'Analysis completed but detailed parsing failed. Manual review recommended.',
        flagged_concerns: ['AI response parsing failed - manual review required'],
      };
    }

    console.log('Verification result:', verificationResult);

    // Update the submission with verification results
    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        ai_similarity_score: verificationResult.similarity_score,
        ai_confidence_score: verificationResult.confidence_score,
        ai_risk_level: verificationResult.risk_level,
        ai_flagged_sections: verificationResult.flagged_concerns,
        ai_analysis_details: verificationResult,
        verified_at: new Date().toISOString(),
      })
      .eq('id', submission_id);

    if (updateError) {
      console.error('Error updating submission:', updateError);
      throw new Error('Failed to update submission with verification results');
    }

    console.log('Submission updated successfully');

    return new Response(JSON.stringify({ 
      success: true, 
      result: verificationResult 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in verify-handwriting function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
