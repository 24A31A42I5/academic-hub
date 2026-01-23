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
  VERIFIED: 70,        // >= 70: Verified (same writer)
  MANUAL_REVIEW: 50,   // 50-69: Manual Review required
  REUPLOAD: 0          // < 50: Reupload Required
};

// Maximum base64 size to send to AI (5MB encoded = ~3.75MB file)
const MAX_BASE64_SIZE = 5 * 1024 * 1024;

async function fetchFileAsBase64(url: string, supabase?: any): Promise<{ base64: string; size: number }> {
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

function determineStatus(score: number, hasCriticalFlag: boolean): string {
  if (hasCriticalFlag || score < VERIFICATION_THRESHOLDS.MANUAL_REVIEW) {
    return 'needs_manual_review';
  }
  if (score < VERIFICATION_THRESHOLDS.VERIFIED) {
    return 'needs_manual_review';
  }
  return 'verified';
}

// Error types for better frontend messaging
type ErrorType = 'no_profile' | 'file_too_large' | 'ai_gateway_error' | 'parse_error' | 'rate_limit' | 'unknown';

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
        message: 'File too large for automatic verification. Manual review required.'
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

    // If no handwriting profile exists, mark for manual review with specific error type
    if (!handwritingProfile || !referenceImageUrl) {
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
            algorithm_version: '3.2-gemini-forensic',
            error_type: fallback.error_type,
            reason: fallback.message,
            recommendation: 'Student needs to submit handwriting sample first'
          },
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        ...fallback
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch both reference image and submitted file as base64
    console.log('Fetching reference handwriting sample...');
    const { base64: referenceBase64, size: refSize } = await fetchFileAsBase64(referenceImageUrl, supabase);
    console.log('Reference file size:', refSize, 'bytes');
    
    console.log('Fetching submitted document...');
    const { base64: submissionBase64, size: subSize } = await fetchFileAsBase64(file_url, supabase);
    console.log('Submission file size:', subSize, 'bytes');

    // Check if files are too large for AI processing
    if (submissionBase64.length > MAX_BASE64_SIZE) {
      console.log('Submission file too large for AI processing:', submissionBase64.length);
      const fallback = getFallbackResult('file_too_large');
      
      await supabase
        .from('submissions')
        .update({
          ai_similarity_score: fallback.score,
          ai_confidence_score: 0,
          ai_risk_level: fallback.risk_level,
          status: fallback.status,
          verified_at: new Date().toISOString(),
          ai_analysis_details: {
            algorithm_version: '3.2-gemini-forensic',
            error_type: fallback.error_type,
            reason: fallback.message,
            file_size: subSize,
            recommendation: 'Please upload a smaller file or use image format instead of PDF'
          },
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        ...fallback
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // Build the optimized verification prompt - forensic handwriting analysis
    const verificationPrompt = `You are an AI handwriting verification engine used in an academic integrity system.

Your task is to compare a student's trained handwriting profile with a newly uploaded handwritten assignment image and determine whether both were written by the same person.

You must analyze only handwriting characteristics, not the meaning, topic, or quality of the text.

## STUDENT'S KNOWN HANDWRITING PROFILE (trained reference):
${JSON.stringify(handwritingProfile, null, 2)}

## ANALYSIS INSTRUCTIONS:

Focus strictly on forensic handwriting features including:
- Letter formation and stroke style
- Curves, loops, hooks, and sharpness
- Slant angle and baseline alignment
- Spacing between letters and words
- Character height ratios and proportions
- Stroke thickness and pressure patterns
- Writing rhythm, consistency, and connections between letters
- Margin habits and line discipline

## PROCESS:
1. Extract distinctive handwriting features from the trained profile above
2. Extract features from the uploaded assignment (second image)
3. Compare structural similarities and differences against the reference sample (first image)
4. Compute an overall similarity score

## IMPORTANT SCORING RULES:
- If the handwriting is clearly from the SAME writer (despite natural variation in pen, paper, speed, mood), give similarity_score >= 75
- If the handwriting is clearly from a DIFFERENT writer, give similarity_score <= 30
- For uncertain cases with some matching and some differing features, use 40-70 range
- If document contains typed/printed text (not handwritten), set is_handwritten = false and similarity_score = 0

## DECISION RULES:
- Be tolerant of natural variation but strict against different writers
- In academic verification, false acceptance is worse than false rejection
- If clearly same writer with high confidence → score 80-95
- If probably same writer but some variation → score 65-79
- If uncertain, could go either way → score 45-64
- If probably different writer → score 25-44
- If clearly different writer → score 0-24

## FINAL DECISION:
- similarity_score >= 70 → same_writer = true
- similarity_score < 70 → same_writer = false

Return ONLY valid JSON. No markdown. No explanations outside JSON.

Output format exactly:
{
  "similarity_score": number from 0 to 100,
  "same_writer": true or false,
  "confidence_level": "low" or "medium" or "high",
  "is_handwritten": true or false,
  "key_matching_features": ["feature1", "feature2", "..."],
  "key_differences": ["difference1", "difference2", "..."],
  "critical_flags": [],
  "final_reasoning": "short technical justification under 50 words"
}

Work internally step-by-step but output only the final JSON.
Prioritize accuracy, objectivity, and consistency.`;

    console.log('Calling Gemini AI for forensic comparison...');

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
      
      let fallback: FallbackResult;
      
      if (aiResponse.status === 429) {
        fallback = getFallbackResult('rate_limit');
      } else if (aiResponse.status === 402) {
        throw new Error('AI credits exhausted. Please add credits to continue.');
      } else if (errorText.includes('Memory limit') || errorText.includes('too large')) {
        fallback = getFallbackResult('file_too_large');
      } else {
        fallback = getFallbackResult('ai_gateway_error');
      }
      
      // For errors, fall back to manual review with specific error type
      console.log('AI failed, falling back to manual review');
      await supabase
        .from('submissions')
        .update({
          ai_similarity_score: fallback.score,
          ai_confidence_score: 0,
          ai_risk_level: fallback.risk_level,
          status: fallback.status,
          verified_at: new Date().toISOString(),
          ai_analysis_details: {
            algorithm_version: '3.2-gemini-forensic',
            error_type: fallback.error_type,
            error: `AI analysis failed: ${aiResponse.status}`,
            reason: fallback.message
          },
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        ...fallback
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
      
      const fallback = getFallbackResult('parse_error');
      
      await supabase
        .from('submissions')
        .update({
          ai_similarity_score: fallback.score,
          ai_confidence_score: 0,
          ai_risk_level: fallback.risk_level,
          status: fallback.status,
          verified_at: new Date().toISOString(),
          ai_analysis_details: {
            algorithm_version: '3.2-gemini-forensic',
            error_type: fallback.error_type,
            error: 'Failed to parse AI response',
            raw_response: responseText.substring(0, 500)
          },
        })
        .eq('id', submission_id);

      return new Response(JSON.stringify({
        success: true,
        ...fallback
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract scores and flags with proper defaults
    const similarityScore = Math.max(0, Math.min(100, verificationResult.similarity_score ?? 50));
    const confidenceLevel = verificationResult.confidence_level || 'medium';
    const confidenceScore = confidenceLevel === 'high' ? 90 : confidenceLevel === 'medium' ? 70 : 50;
    const criticalFlags = verificationResult.critical_flags || [];
    const isHandwritten = verificationResult.is_handwritten !== false;
    const hasCriticalFlag = criticalFlags.length > 0 || !isHandwritten;

    // Determine final status based on Gemini's analysis
    const riskLevel = determineRiskLevel(similarityScore, hasCriticalFlag);
    const status = determineStatus(similarityScore, hasCriticalFlag);

    console.log('Verification result:', {
      similarityScore,
      confidenceScore,
      confidenceLevel,
      riskLevel,
      status,
      same_writer: verificationResult.same_writer,
      is_handwritten: isHandwritten
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
          algorithm_version: '3.2-gemini-forensic',
          same_writer: verificationResult.same_writer,
          is_handwritten: isHandwritten,
          confidence_level: confidenceLevel,
          key_matching_features: verificationResult.key_matching_features || [],
          key_differences: verificationResult.key_differences || [],
          final_reasoning: verificationResult.final_reasoning || '',
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
      confidence_level: confidenceLevel,
      risk_level: riskLevel,
      status: status,
      same_writer: verificationResult.same_writer,
      is_handwritten: isHandwritten,
      summary: verificationResult.final_reasoning
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
        const fallback = getFallbackResult('unknown');
        
        await supabase
          .from('submissions')
          .update({
            ai_similarity_score: fallback.score,
            ai_risk_level: fallback.risk_level,
            status: fallback.status,
            verified_at: new Date().toISOString(),
            ai_analysis_details: {
              algorithm_version: '3.2-gemini-forensic',
              error_type: fallback.error_type,
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
