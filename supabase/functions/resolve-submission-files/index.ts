import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    // Extract and verify token using admin client only
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return errorResponse('Missing authorization token', 401);
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return errorResponse('Unauthorized', 401);
    }

    // Look up caller's profile
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('user_id', user.id)
      .single();

    if (profileError || !callerProfile) {
      return errorResponse('Profile not found', 403);
    }

    const { submission_id } = await req.json();
    if (!submission_id) {
      return errorResponse('Missing submission_id', 400);
    }

    // Fetch submission
    const { data: submission, error: subError } = await supabaseAdmin
      .from('submissions')
      .select('student_profile_id, file_url, file_urls, assignment_id')
      .eq('id', submission_id)
      .single();

    if (subError || !submission) {
      return errorResponse('Submission not found', 404);
    }

    // Fetch assignment for faculty check
    const { data: assignment } = await supabaseAdmin
      .from('assignments')
      .select('faculty_profile_id')
      .eq('id', submission.assignment_id)
      .single();

    // Authorization: student owner, faculty for assignment, or admin
    const isOwner = callerProfile.id === submission.student_profile_id;
    const isFaculty = callerProfile.role === 'faculty' && assignment?.faculty_profile_id === callerProfile.id;
    const isAdmin = callerProfile.role === 'admin';

    if (!isOwner && !isFaculty && !isAdmin) {
      return errorResponse('Forbidden', 403);
    }

    // Collect paths: prefer file_urls, fall back to file_url
    const rawPaths: string[] = submission.file_urls && submission.file_urls.length > 0
      ? submission.file_urls
      : submission.file_url
        ? [submission.file_url]
        : [];

    // Normalize and sign each path
    const signedUrls: string[] = [];
    for (const path of rawPaths) {
      let storagePath: string;

      if (path.startsWith('http')) {
        // Extract everything after /uploads/ and strip query params
        const match = path.split('/uploads/')[1];
        storagePath = match ? match.split('?')[0] : path;
      } else {
        storagePath = path;
      }

      const { data: signedData, error: signError } = await supabaseAdmin.storage
        .from('uploads')
        .createSignedUrl(storagePath, 3600);

      if (signError || !signedData?.signedUrl) {
        console.error('Failed to sign URL for path:', storagePath, signError);
        continue;
      }

      signedUrls.push(signedData.signedUrl);
    }

    return new Response(JSON.stringify({ signed_urls: signedUrls }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('resolve-submission-files error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
