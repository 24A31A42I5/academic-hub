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

interface VerificationResult {
  similarity_score: number;
  confidence_score: number;
  risk_level: 'low' | 'medium' | 'high';
  feature_comparison: {
    [key: string]: {
      reference: number;
      submission: number;
      difference: number;
      match: boolean;
    };
  };
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

// Compute cosine similarity between two feature vectors
function computeCosineSimilarity(a: HandwritingFeatures, b: HandwritingFeatures): number {
  const keys = Object.keys(a) as (keyof HandwritingFeatures)[];
  
  // Normalize the features based on their ranges
  const ranges: { [K in keyof HandwritingFeatures]: [number, number] } = {
    slant_angle: [-45, 45],
    stroke_width: [1, 10],
    letter_height_ratio: [0.3, 0.9],
    inter_letter_spacing: [1, 10],
    inter_word_spacing: [1, 10],
    baseline_stability: [1, 10],
    letter_roundness: [1, 10],
    connection_style: [0, 100],
    pressure_variation: [1, 10],
    character_consistency: [1, 10],
  };

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const key of keys) {
    const [min, max] = ranges[key];
    const range = max - min;
    const normalizedA = (a[key] - min) / range;
    const normalizedB = (b[key] - min) / range;
    
    dotProduct += normalizedA * normalizedB;
    normA += normalizedA * normalizedA;
    normB += normalizedB * normalizedB;
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.round(similarity * 100);
}

// Compare features and determine which match
function compareFeatures(reference: HandwritingFeatures, submission: HandwritingFeatures) {
  const thresholds: { [K in keyof HandwritingFeatures]: number } = {
    slant_angle: 10, // degrees
    stroke_width: 2,
    letter_height_ratio: 0.15,
    inter_letter_spacing: 2,
    inter_word_spacing: 2,
    baseline_stability: 2,
    letter_roundness: 2,
    connection_style: 20, // percentage
    pressure_variation: 2,
    character_consistency: 2,
  };

  const comparison: VerificationResult['feature_comparison'] = {};
  
  for (const key of Object.keys(reference) as (keyof HandwritingFeatures)[]) {
    const diff = Math.abs(reference[key] - submission[key]);
    comparison[key] = {
      reference: reference[key],
      submission: submission[key],
      difference: diff,
      match: diff <= thresholds[key],
    };
  }

  return comparison;
}

// Maximum file size in bytes (5MB to stay well under memory limits)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

async function fetchFileAsBase64(url: string, supabase?: any): Promise<string> {
  console.log('Fetching file:', url);

  // For uploads bucket (private files)
  if (url.includes('/storage/v1/object/public/uploads/') && supabase) {
    const pathMatch = url.match(/\/uploads\/(.+)$/);
    if (pathMatch) {
      const filePath = pathMatch[1];
      console.log('Downloading from private bucket, path:', filePath);

      const { data, error } = await supabase.storage
        .from('uploads')
        .download(filePath);

      if (error) {
        console.error('Storage download error:', error);
        throw new Error(`Failed to download from storage: ${error.message}`);
      }

      const arrayBuffer = await data.arrayBuffer();
      
      // Check file size
      if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
        console.log(`File too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB), using first ${MAX_FILE_SIZE / 1024 / 1024}MB only`);
        // For PDFs, we can only analyze the first few pages anyway
        const truncated = arrayBuffer.slice(0, MAX_FILE_SIZE);
        return encode(new Uint8Array(truncated));
      }
      
      return encode(new Uint8Array(arrayBuffer));
    }
  }

  // For public files or handwriting samples
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  
  // Check file size
  if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
    console.log(`File too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB), using first ${MAX_FILE_SIZE / 1024 / 1024}MB only`);
    const truncated = arrayBuffer.slice(0, MAX_FILE_SIZE);
    return encode(new Uint8Array(truncated));
  }
  
  return encode(new Uint8Array(arrayBuffer));
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
    console.log('Student Profile ID:', student_profile_id);

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Mark as pending immediately
    await supabase
      .from('submissions')
      .update({
        ai_risk_level: 'pending',
        verified_at: null,
        ai_similarity_score: null,
        ai_confidence_score: null,
        ai_flagged_sections: null,
        ai_analysis_details: null,
      })
      .eq('id', submission_id);

    // Fetch student's reference handwriting and features
    const { data: studentDetails, error: studentError } = await supabase
      .from('student_details')
      .select('handwriting_url, handwriting_feature_embedding, handwriting_image_hash, profile_id')
      .eq('profile_id', student_profile_id)
      .single();

    if (studentError) {
      console.error('Error fetching student details:', studentError);
      throw new Error('Failed to fetch student details');
    }

    if (!studentDetails?.handwriting_url) {
      console.log('No handwriting sample found for student');
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

    const referenceFeatures = studentDetails.handwriting_feature_embedding as HandwritingFeatures | null;
    console.log('Reference features available:', !!referenceFeatures);

    // Fetch both files
    const [referenceBase64, submissionBase64] = await Promise.all([
      fetchFileAsBase64(studentDetails.handwriting_url, supabase),
      fetchFileAsBase64(file_url, supabase),
    ]);

    const referenceMimeType = getMimeType(studentDetails.handwriting_url);
    const submissionMimeType = getMimeType(file_url, file_type);

    // Build the AI prompt for feature extraction AND comparison
    const analysisPrompt = `You are an expert forensic document examiner specializing in handwriting analysis and writer identification.

## TASK
Compare the REFERENCE handwriting sample (Image 1) against the ASSIGNMENT submission (Image 2/Document) to determine if they were written by the SAME PERSON.

## STEP 1: Extract Features from BOTH Samples

For EACH sample, extract these numerical features:
1. **slant_angle** (-45 to +45 degrees): Angle of vertical strokes from true vertical
2. **stroke_width** (1-10): Average thickness of pen strokes
3. **letter_height_ratio** (0.3-0.9): x-height to total height ratio
4. **inter_letter_spacing** (1-10): Space between letters
5. **inter_word_spacing** (1-10): Space between words
6. **baseline_stability** (1-10): How straight the baseline is
7. **letter_roundness** (1-10): Angular vs rounded letters
8. **connection_style** (0-100): Percentage of connected letters
9. **pressure_variation** (1-10): Consistency of pen pressure
10. **character_consistency** (1-10): How similar same letters look

## STEP 2: Visual Analysis

Examine these characteristics:
- **Letter Formation**: How specific letters are constructed (a, d, e, g, o, s, t)
- **Slant Angle**: Overall slant direction and consistency
- **Spacing**: Between letters and words
- **Baseline**: How straight/wavy the writing line is
- **Unique Features**: Personal quirks, i-dots, t-crosses, etc.

## CRITICAL DETECTION FLAGS
- Assignment is TYPED but reference is handwritten = CRITICAL (similarity < 20)
- Completely different slant angle = HIGH RISK
- Different letter construction methods = HIGH RISK
- Inconsistent pressure patterns between samples = MEDIUM RISK

## OUTPUT FORMAT
Respond with ONLY this JSON (no markdown, no extra text):

{
  "submission_features": {
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
  },
  "similarity_score": <0-100>,
  "confidence_score": <0-100>,
  "risk_level": "low" | "medium" | "high",
  "analysis_details": {
    "letter_formation": { "match": <true/false>, "notes": "<detailed comparison>" },
    "slant_angle": { "match": <true/false>, "notes": "<measured angle comparison>" },
    "spacing": { "match": <true/false>, "notes": "<spacing comparison>" },
    "baseline": { "match": <true/false>, "notes": "<baseline comparison>" },
    "unique_features": { "match": <true/false>, "notes": "<unique characteristics>" }
  },
  "overall_conclusion": "<2-3 sentence professional assessment>",
  "flagged_concerns": ["<specific concern 1>", "<specific concern 2>"]
}

## SCORING RUBRIC
- **85-100**: Same writer (8+ matching features, no significant differences)
- **70-84**: Probable same writer (5-7 matching features)
- **50-69**: Inconclusive (requires human review)
- **30-49**: Probable different writer
- **0-29**: Different writer OR typed content

## RISK LEVEL
- "low": similarity >= 85 AND confidence >= 70
- "medium": similarity 50-84 OR confidence 40-69
- "high": similarity < 50 OR critical flags detected

BE STRICT. Academic integrity depends on accurate analysis.`;

    const content: any[] = [
      { type: 'text', text: analysisPrompt },
      {
        type: 'image_url',
        image_url: { url: `data:${referenceMimeType};base64,${referenceBase64}` }
      }
    ];

    // Add submission
    if (submissionMimeType === 'application/pdf') {
      content.push({
        type: 'image_url',
        image_url: { url: `data:application/pdf;base64,${submissionBase64}` }
      });
    } else if (submissionMimeType.startsWith('image/')) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${submissionMimeType};base64,${submissionBase64}` }
      });
    } else {
      content.push({
        type: 'text',
        text: 'Note: The submission is a Word document. Analyze visible handwriting or note if typed.'
      });
      content.push({
        type: 'image_url',
        image_url: { url: `data:${submissionMimeType};base64,${submissionBase64}` }
      });
    }

    console.log('Calling Lovable AI for analysis...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content }],
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

    // Parse the response
    let aiResult: any;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      aiResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      aiResult = {
        submission_features: null,
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
        overall_conclusion: 'Analysis completed but parsing failed. Manual review recommended.',
        flagged_concerns: ['AI response parsing failed - manual review required'],
      };
    }

    // If we have reference features and submission features, compute our own similarity
    let finalSimilarity = aiResult.similarity_score;
    let featureComparison = null;

    if (referenceFeatures && aiResult.submission_features) {
      const computedSimilarity = computeCosineSimilarity(referenceFeatures, aiResult.submission_features);
      featureComparison = compareFeatures(referenceFeatures, aiResult.submission_features);
      
      // Average AI similarity with computed similarity for more robust result
      finalSimilarity = Math.round((aiResult.similarity_score + computedSimilarity) / 2);
      
      console.log('Computed similarity:', computedSimilarity);
      console.log('AI similarity:', aiResult.similarity_score);
      console.log('Final similarity:', finalSimilarity);
    }

    // Determine final risk level based on final similarity
    let riskLevel: 'low' | 'medium' | 'high';
    if (finalSimilarity >= 85 && aiResult.confidence_score >= 70) {
      riskLevel = 'low';
    } else if (finalSimilarity >= 50 || aiResult.confidence_score >= 40) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'high';
    }

    const verificationResult: VerificationResult = {
      similarity_score: finalSimilarity,
      confidence_score: aiResult.confidence_score,
      risk_level: riskLevel,
      feature_comparison: featureComparison || {},
      analysis_details: aiResult.analysis_details,
      overall_conclusion: aiResult.overall_conclusion,
      flagged_concerns: aiResult.flagged_concerns || [],
    };

    console.log('Final verification result:', verificationResult);

    // Update submission
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
      throw new Error('Failed to update submission');
    }

    console.log('Submission updated successfully');

    // Send notification if flagged
    if (verificationResult.risk_level === 'high' || verificationResult.risk_level === 'medium') {
      console.log('Submission flagged, sending notification...');
      
      const { data: profileData } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', student_profile_id)
        .single();
      
      const { data: submissionData } = await supabase
        .from('submissions')
        .select('assignment:assignments(title)')
        .eq('id', submission_id)
        .single();
      
      if (profileData?.email) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              type: 'submission_flagged',
              data: {
                studentEmail: profileData.email,
                studentName: profileData.full_name,
                assignmentTitle: (submissionData?.assignment as any)?.title || 'Assignment',
                riskLevel: verificationResult.risk_level,
                similarityScore: verificationResult.similarity_score,
                flaggedConcerns: verificationResult.flagged_concerns,
              },
            }),
          });
        } catch (notifyError) {
          console.error('Failed to send notification:', notifyError);
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      result: verificationResult 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in verify-handwriting:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});