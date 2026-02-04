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

// Maximum base64 size to send to AI (5MB encoded = ~3.75MB file)
const MAX_BASE64_SIZE = 5 * 1024 * 1024;

interface PageResult {
  page: number;
  similarity: number;
  same_writer: boolean;
  is_handwritten: boolean;
  confidence: string;
}

async function fetchImageAsBase64(urlOrPath: string, supabase: any): Promise<{ base64: string; size: number }> {
  console.log('Fetching image:', urlOrPath);
  
  let url = urlOrPath;
  
  // If it's a path (not starting with http), generate a signed URL
  if (!urlOrPath.startsWith('http')) {
    console.log('Generating signed URL for path:', urlOrPath);
    const { data: signedData, error: signedError } = await supabase.storage
      .from('uploads')
      .createSignedUrl(urlOrPath, 300); // 5 minute expiry
    
    if (signedError) {
      console.error('Error creating signed URL:', signedError);
      throw new Error(`Failed to access file: ${signedError.message}`);
    }
    
    url = signedData.signedUrl;
    console.log('Using signed URL for path');
  } else if (urlOrPath.includes('/storage/v1/object/public/uploads/')) {
    // It's a public URL to a private bucket - extract path and sign it
    const match = urlOrPath.match(/\/storage\/v1\/object\/public\/uploads\/(.+)/);
    if (match) {
      const filePath = match[1];
      console.log('Generating signed URL for extracted path:', filePath);
      
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

// Error types for better frontend messaging
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

async function verifyPage(
  pageNumber: number,
  imageBase64: string,
  referenceBase64: string,
  handwritingProfile: any,
  apiKey: string
): Promise<PageResult> {
  const verificationPrompt = `You are an AI handwriting verification engine analyzing a SINGLE PAGE of a handwritten assignment.

CRITICAL RULES:
1. ONLY analyze handwriting characteristics - ignore content, meaning, subject matter
2. First determine if this page is HANDWRITTEN or TYPED/PRINTED
3. If typed/printed → is_handwritten = false, similarity_score = 0
4. If handwritten → compare against the student's trained profile

## STUDENT'S KNOWN HANDWRITING PROFILE:
${JSON.stringify(handwritingProfile, null, 2)}

## ANALYSIS FOCUS (forensic handwriting features):
- Letter formation and stroke style
- Curves, loops, hooks, and sharpness
- Slant angle and baseline alignment
- Spacing between letters and words
- Character height ratios and proportions
- Stroke thickness and pressure patterns
- Writing rhythm, consistency, and connections

## SCORING RULES:
- Same writer with natural variation: similarity_score >= 75
- Clearly different writer: similarity_score <= 30
- Uncertain cases: similarity_score 40-74
- Typed/printed content: is_handwritten = false, similarity_score = 0

## DECISION:
- similarity_score >= 75 → same_writer = true
- similarity_score < 75 → same_writer = false

Return ONLY valid JSON. No markdown. No explanations outside JSON.

Output format exactly:
{
  "similarity_score": number from 0 to 100,
  "same_writer": true or false,
  "confidence_level": "low" or "medium" or "high",
  "is_handwritten": true or false,
  "key_observations": ["observation1", "observation2"]
}`;

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
            { type: 'text', text: verificationPrompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${referenceBase64}` }
            },
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
    throw new Error(`AI Gateway error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const responseText = aiData.choices?.[0]?.message?.content || '';

  // Parse the verification result
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in AI response');
  }

  const result = JSON.parse(jsonMatch[0]);

  return {
    page: pageNumber,
    similarity: Math.max(0, Math.min(100, result.similarity_score ?? 50)),
    same_writer: result.same_writer ?? false,
    is_handwritten: result.is_handwritten !== false,
    confidence: result.confidence_level || 'medium'
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { submission_id, file_urls, file_url, student_profile_id, page_count } = body;

    // Support both single file_url (backward compat) and file_urls array
    const imageUrls: string[] = file_urls || (file_url ? [file_url] : []);

    console.log('=== IMAGE-ONLY HANDWRITING VERIFICATION START ===');
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
            algorithm_version: '4.0-image-only',
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

    // Fetch reference image
    console.log('Fetching reference handwriting sample...');
    const { base64: referenceBase64, size: refSize } = await fetchImageAsBase64(referenceImageUrl, supabase);
    console.log('Reference image size:', refSize, 'bytes');

    // Process each page
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

        // Verify this page
        const pageResult = await verifyPage(
          pageNum,
          pageBase64,
          referenceBase64,
          handwritingProfile,
          LOVABLE_API_KEY
        );

        pageResults.push(pageResult);

        if (!pageResult.is_handwritten) {
          hasTypedContent = true;
        }
        if (!pageResult.same_writer) {
          hasDifferentWriter = true;
        }

        console.log(`Page ${pageNum} result:`, pageResult);

      } catch (pageError: any) {
        console.error(`Error processing page ${pageNum}:`, pageError);
        // Add a fallback result for this page
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
          algorithm_version: '4.0-image-only',
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