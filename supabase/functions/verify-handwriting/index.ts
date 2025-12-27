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

async function fetchFileAsBase64(url: string, supabase?: any): Promise<string> {
  console.log('Fetching file:', url);
  
  // Check if it's a Supabase storage URL that needs authenticated access
  if (url.includes('/storage/v1/object/public/uploads/') && supabase) {
    // Extract the path from the URL for private bucket access
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
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      return btoa(binary);
    }
  }
  
  // Fallback to regular fetch for public URLs
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
      fetchFileAsBase64(studentDetails.handwriting_url, supabase),
      fetchFileAsBase64(file_url, supabase),
    ]);

    const referenceMimeType = getMimeType(studentDetails.handwriting_url);
    const submissionMimeType = getMimeType(file_url, file_type);

    console.log('Reference MIME type:', referenceMimeType);
    console.log('Submission MIME type:', submissionMimeType);

    // Build the message content based on file types
    const content: any[] = [
      {
        type: 'text',
        text: `You are an expert forensic document examiner specializing in handwriting analysis and writer identification. You have been trained on the principles of graphology, questioned document examination, and pattern recognition.

## TASK
Compare the REFERENCE handwriting sample (Image 1) against the ASSIGNMENT submission (Image 2/Document) to determine if they were written by the SAME PERSON.

## ANALYSIS METHODOLOGY

### Phase 1: Document Classification
First, determine what type of content is in each sample:
- Is it handwritten, typed, printed, or a mix?
- If the assignment is typed/printed, this is a CRITICAL FLAG.

### Phase 2: Individual Character Analysis
For handwritten content, examine these specific letter forms across BOTH samples:
- **Lowercase letters**: a, d, e, g, o, s, t, r, n, m
- **Uppercase letters**: A, B, D, E, M, N, S, T
- **Number formations**: 0, 1, 2, 3, 4, 5, 7, 8, 9
- **Special connections**: how letters connect (t-h, i-n, e-r patterns)

### Phase 3: Class Characteristics (Taught patterns)
- General style (cursive, print, mixed)
- Slant direction and consistency (measure in degrees if possible)
- Size consistency (x-height, ascender/descender ratios)
- Baseline behavior (straight, wavy, ascending, descending)

### Phase 4: Individual Characteristics (Personal habits)
- **Pen lifts**: Where does the writer lift the pen within words?
- **Entry/exit strokes**: How do letters begin and end?
- **Unusual formations**: Personal quirks in specific letters
- **i-dots and t-crosses**: Position, shape, and connection patterns
- **Pressure patterns**: Thick/thin variations in strokes
- **Speed indicators**: Smooth curves vs. angular hesitations

### Phase 5: Comparison Conclusion
- Count the number of MATCHING individual characteristics
- Count the number of SIGNIFICANT DIFFERENCES
- A single fundamental difference can indicate different writers
- 8+ matching individual characteristics suggests same writer

## CRITICAL DETECTION FLAGS
Watch for these RED FLAGS that indicate potential fraud:
1. Assignment is TYPED but reference is handwritten = CRITICAL
2. Completely different slant angle (e.g., 45° right vs. vertical) = HIGH RISK
3. Different letter construction (e.g., one-stroke 'a' vs. two-stroke 'a') = HIGH RISK
4. Inconsistent pen pressure patterns = MEDIUM RISK
5. Different baseline behaviors = MEDIUM RISK
6. Writing appears traced or unnaturally slow = HIGH RISK

## OUTPUT FORMAT
Respond with ONLY this JSON (no markdown, no extra text):

{
  "similarity_score": <0-100>,
  "confidence_score": <0-100>,
  "risk_level": "low" | "medium" | "high",
  "analysis_details": {
    "letter_formation": {
      "match": <true/false>,
      "notes": "<Compare 3+ specific letters with detailed observations>"
    },
    "slant_angle": {
      "match": <true/false>,
      "notes": "<Measured angle comparison, e.g., 'Both samples show 15-20° rightward slant'>"
    },
    "spacing": {
      "match": <true/false>,
      "notes": "<Inter-letter and inter-word spacing comparison>"
    },
    "baseline": {
      "match": <true/false>,
      "notes": "<Baseline consistency and direction>"
    },
    "unique_features": {
      "match": <true/false>,
      "notes": "<List 2-3 distinctive personal characteristics found in both or only one sample>"
    }
  },
  "overall_conclusion": "<Professional 2-3 sentence assessment with confidence level and recommendation>",
  "flagged_concerns": ["<Specific concern 1>", "<Specific concern 2>"]
}

## SCORING RUBRIC
- **90-100**: Near-certain same writer (8+ matching individual characteristics, no significant differences)
- **70-89**: Probable same writer (5-7 matching characteristics, minor differences explainable)
- **50-69**: Inconclusive (mixed evidence, requires human expert review)
- **30-49**: Probable different writer (significant differences noted)
- **0-29**: Near-certain different writer OR typed/printed content

## RISK LEVEL ASSIGNMENT
- "low": similarity_score >= 70 AND confidence_score >= 60
- "medium": similarity_score 40-69 OR confidence_score 40-59
- "high": similarity_score < 40 OR critical flags detected

BE STRICT AND PRECISE. Academic integrity depends on accurate analysis.`
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

    // Call Lovable AI with Gemini 2.5 Flash for faster vision analysis
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

    // Send email notification if submission is flagged (high or medium risk)
    if (verificationResult.risk_level === 'high' || verificationResult.risk_level === 'medium') {
      console.log('Submission flagged, sending notification...');
      
      // Fetch student info for email
      const { data: profileData } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', student_profile_id)
        .single();
      
      // Fetch assignment title
      const { data: submissionData } = await supabase
        .from('submissions')
        .select('assignment:assignments(title)')
        .eq('id', submission_id)
        .single();
      
      if (profileData?.email) {
        try {
          const notifyResponse = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
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
          
          const notifyResult = await notifyResponse.json();
          console.log('Notification result:', notifyResult);
        } catch (notifyError) {
          console.error('Failed to send notification:', notifyError);
          // Don't fail the main function if notification fails
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
    console.error('Error in verify-handwriting function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
