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

// ==================== CONFIGURATION ====================
const VERIFICATION_THRESHOLDS = {
  VERIFIED: 75,        // >= 75: Verified (same writer)
  MANUAL_REVIEW: 50,   // 50-74: Manual Review required
  REUPLOAD: 0          // < 50: Reupload Required
};

async function fetchFileAsBase64(url: string, supabase?: any): Promise<string> {
  console.log('Fetching file:', url);
  
  // Check if this is a Supabase storage URL that needs a signed URL
  const uploadsBucketMatch = url.match(/\/storage\/v1\/object\/public\/uploads\/(.+)$/);
  if (uploadsBucketMatch && supabase) {
    const filePath = uploadsBucketMatch[1];
    console.log('Generating signed URL for private bucket, path:', filePath);
    
    const { data: signedData, error: signedError } = await supabase.storage
      .from('uploads')
      .createSignedUrl(filePath, 300); // 5 minute expiry
    
    if (signedError) {
      console.error('Error creating signed URL:', signedError);
      throw new Error(`Failed to access file: ${signedError.message}`);
    }
    
    url = signedData.signedUrl;
    console.log('Using signed URL');
  }
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return encode(arrayBuffer);
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

function determineStatus(score: number, hasCriticalFlag: boolean): string {
  if (hasCriticalFlag || score < VERIFICATION_THRESHOLDS.MANUAL_REVIEW) {
    return 'needs_manual_review';
  }
  if (score < VERIFICATION_THRESHOLDS.VERIFIED) {
    return 'needs_manual_review';
  }
  return 'verified';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submission_id, file_url, student_profile_id, file_type } = await req.json();

    console.log('=== GEMINI HANDWRITING VERIFICATION START ===');
    console.log('Submission ID:', submission_id);
    console.log('File URL:', file_url);
    console.log('Student Profile ID:', student_profile_id);
    console.log('File Type:', file_type);

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get student's trained handwriting profile
    const { data: studentDetails, error: studentError } = await supabase
      .from('student_details')
      .select('handwriting_feature_embedding, handwriting_url, roll_number')
      .eq('profile_id', student_profile_id)
      .single();

    if (studentError) {
      console.error('Error fetching student details:', studentError);
      throw new Error('Failed to fetch student details');
    }

    const handwritingProfile = studentDetails?.handwriting_feature_embedding;
    const referenceImageUrl = studentDetails?.handwriting_url;

    // If no handwriting profile exists, mark for manual review
    if (!handwritingProfile || !referenceImageUrl) {
      console.log('No handwriting profile found - marking for manual review');
      
      await supabase
        .from('submissions')
        .update({
          ai_similarity_score: 50,
          ai_confidence_score: 0,
          ai_risk_level: 'medium',
          status: 'needs_manual_review',
          verified_at: new Date().toISOString(),
          ai_analysis_details: {
            algorithm_version: '3.0-gemini',
            reason: 'No handwriting reference available for this student',
            recommendation: 'Student needs to submit handwriting sample first'
          },
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        score: 50,
        risk_level: 'medium',
        status: 'needs_manual_review',
        message: 'No handwriting reference - manual review required'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch both reference image and submitted file as base64
    console.log('Fetching reference handwriting sample...');
    const referenceBase64 = await fetchFileAsBase64(referenceImageUrl, supabase);
    
    console.log('Fetching submitted document...');
    const submissionBase64 = await fetchFileAsBase64(file_url, supabase);

    // Determine file type for proper MIME
    const isImage = file_type?.toLowerCase().includes('image') || 
                    file_url.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    const isPdf = file_type?.toLowerCase().includes('pdf') || 
                  file_url.match(/\.pdf$/i);

    let submissionMime = 'image/jpeg';
    if (isPdf) {
      submissionMime = 'application/pdf';
    } else if (file_url.match(/\.png$/i)) {
      submissionMime = 'image/png';
    }

    // Build the verification prompt with the trained profile
    const verificationPrompt = `You are a forensic handwriting verification expert. You have been trained on a specific student's handwriting style and must now verify if a submitted document was written by the same person.

## STUDENT'S KNOWN HANDWRITING PROFILE:
${JSON.stringify(handwritingProfile, null, 2)}

## YOUR TASK:
Compare the SUBMITTED DOCUMENT (second image) against the REFERENCE SAMPLE (first image) to determine if they were written by the same person.

## ANALYSIS STEPS:
1. Examine the reference handwriting sample carefully
2. Look at the submitted document
3. Compare letter formations, spacing, stroke characteristics, slant, and unique identifiers
4. Look for the specific unique characteristics mentioned in the profile
5. Consider natural variations (people's handwriting varies slightly day to day)
6. Watch for signs of:
   - Different writer (completely different style)
   - Typed/printed text (not handwritten)
   - Traced/copied handwriting (unnatural precision)
   - Forgery attempt (inconsistent with natural variations)

## SCORING GUIDELINES:
- 90-100: Definitely the same person (strong match on unique identifiers)
- 75-89: Very likely the same person (most characteristics match)
- 60-74: Possibly the same person (some matching, some differences)
- 40-59: Unlikely the same person (significant differences)
- 0-39: Definitely NOT the same person or not handwritten

RESPOND WITH ONLY THIS JSON (no markdown, no extra text):
{
  "similarity_score": <0-100>,
  "confidence_score": <0-100>,
  "is_same_writer": <true/false>,
  "is_handwritten": <true/false>,
  "matching_characteristics": [
    "<characteristic that matches>"
  ],
  "different_characteristics": [
    "<characteristic that differs>"
  ],
  "unique_identifiers_matched": <number out of total>,
  "critical_flags": [],
  "analysis_summary": "<2-3 sentence summary of the comparison>",
  "recommendation": "<VERIFIED|MANUAL_REVIEW|REUPLOAD_REQUIRED>"
}

IMPORTANT: 
- If the document is typed/printed, set is_handwritten=false and score=0
- If it's clearly a different person, be confident and give low score
- If the unique identifiers match well, it's likely the same person
- Natural day-to-day variations are normal, don't penalize those`;

    console.log('Calling Gemini AI for direct comparison...');

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
              { type: 'text', text: verificationPrompt },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${referenceBase64}` }
              },
              {
                type: 'image_url',
                image_url: { url: `data:${submissionMime};base64,${submissionBase64}` }
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
      
      // For other errors, fall back to manual review
      console.log('AI failed, falling back to manual review');
      await supabase
        .from('submissions')
        .update({
          ai_similarity_score: 60,
          ai_confidence_score: 0,
          ai_risk_level: 'medium',
          status: 'needs_manual_review',
          verified_at: new Date().toISOString(),
          ai_analysis_details: {
            algorithm_version: '3.0-gemini',
            error: `AI analysis failed: ${aiResponse.status}`,
            reason: 'Could not process document - requires faculty review'
          },
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        score: 60,
        risk_level: 'medium',
        status: 'needs_manual_review',
        message: 'AI analysis failed - marked for manual review'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiData = await aiResponse.json();
    const responseText = aiData.choices?.[0]?.message?.content || '';
    console.log('Gemini verification response received');

    // Parse the verification result
    let verificationResult: any;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      verificationResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.log('Raw response:', responseText);
      
      // Fall back to manual review
      await supabase
        .from('submissions')
        .update({
          ai_similarity_score: 60,
          ai_confidence_score: 0,
          ai_risk_level: 'medium',
          status: 'needs_manual_review',
          verified_at: new Date().toISOString(),
          ai_analysis_details: {
            algorithm_version: '3.0-gemini',
            error: 'Failed to parse AI response',
            raw_response: responseText.substring(0, 500)
          },
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        score: 60,
        risk_level: 'medium',
        status: 'needs_manual_review',
        message: 'Could not parse AI response - marked for manual review'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract scores and flags
    const similarityScore = Math.max(0, Math.min(100, verificationResult.similarity_score || 50));
    const confidenceScore = Math.max(0, Math.min(100, verificationResult.confidence_score || 50));
    const criticalFlags = verificationResult.critical_flags || [];
    const hasCriticalFlag = criticalFlags.length > 0 || !verificationResult.is_handwritten;

    // Determine final status
    const riskLevel = determineRiskLevel(similarityScore, hasCriticalFlag);
    const status = determineStatus(similarityScore, hasCriticalFlag);

    console.log('Verification result:', {
      similarityScore,
      confidenceScore,
      riskLevel,
      status,
      is_same_writer: verificationResult.is_same_writer,
      is_handwritten: verificationResult.is_handwritten
    });

    // Update submission with results
    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        ai_similarity_score: similarityScore,
        ai_confidence_score: confidenceScore,
        ai_risk_level: riskLevel,
        status: status,
        verified_at: new Date().toISOString(),
        ai_analysis_details: {
          algorithm_version: '3.0-gemini',
          is_same_writer: verificationResult.is_same_writer,
          is_handwritten: verificationResult.is_handwritten,
          matching_characteristics: verificationResult.matching_characteristics,
          different_characteristics: verificationResult.different_characteristics,
          unique_identifiers_matched: verificationResult.unique_identifiers_matched,
          analysis_summary: verificationResult.analysis_summary,
          recommendation: verificationResult.recommendation,
          critical_flags: criticalFlags
        },
        ai_flagged_sections: criticalFlags,
      })
      .eq('id', submission_id);

    if (updateError) {
      console.error('Error updating submission:', updateError);
      throw new Error('Failed to update submission with verification results');
    }

    console.log('=== GEMINI HANDWRITING VERIFICATION COMPLETE ===');

    return new Response(JSON.stringify({
      success: true,
      score: similarityScore,
      confidence: confidenceScore,
      risk_level: riskLevel,
      status: status,
      is_same_writer: verificationResult.is_same_writer,
      is_handwritten: verificationResult.is_handwritten,
      summary: verificationResult.analysis_summary
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in verify-handwriting:', error);
    
    // Try to mark submission for manual review on error
    try {
      const { submission_id } = await req.json().catch(() => ({}));
      if (submission_id) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await supabase
          .from('submissions')
          .update({
            ai_similarity_score: 50,
            ai_risk_level: 'medium',
            status: 'needs_manual_review',
            verified_at: new Date().toISOString(),
            ai_analysis_details: {
              algorithm_version: '3.0-gemini',
              error: error instanceof Error ? error.message : 'Unknown error'
            },
          })
          .eq('id', submission_id);
      }
    } catch (e) {
      console.error('Could not update submission on error:', e);
    }

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
