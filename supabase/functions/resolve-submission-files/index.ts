import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Get authorization header to verify user
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with service role for storage operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Create client with user token to verify access
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { authorization: authHeader } }
    });

    // Get user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { submission_id } = await req.json();

    if (!submission_id) {
      return new Response(
        JSON.stringify({ error: 'Missing submission_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Resolving files for submission:', submission_id, 'User:', user.id);

    // Get user's profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Profile error:', profileError);
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get submission with assignment info
    const { data: submission, error: submissionError } = await supabaseAdmin
      .from('submissions')
      .select(`
        id,
        student_profile_id,
        file_url,
        file_urls,
        assignment_id
      `)
      .eq('id', submission_id)
      .single();

    if (submissionError || !submission) {
      console.error('Submission fetch error:', submissionError);
      return new Response(
        JSON.stringify({ error: 'Submission not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get assignment for faculty check
    const { data: assignment } = await supabaseAdmin
      .from('assignments')
      .select('faculty_profile_id')
      .eq('id', submission.assignment_id)
      .single();

    // Check access permissions
    const isStudent = profile.role === 'student' && submission.student_profile_id === profile.id;
    const isFaculty = profile.role === 'faculty' && assignment?.faculty_profile_id === profile.id;
    const isAdmin = profile.role === 'admin';

    if (!isStudent && !isFaculty && !isAdmin) {
      console.error('Access denied for profile:', profile.id, 'role:', profile.role);
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get file URLs to resolve
    let filePaths: string[] = [];
    
    if (submission.file_urls && submission.file_urls.length > 0) {
      filePaths = submission.file_urls;
    } else if (submission.file_url) {
      filePaths = [submission.file_url];
    }

    console.log('Raw file paths:', filePaths);

    // Convert URLs/paths to storage paths
    const storagePaths = filePaths.map((url: string) => {
      // If it's a full URL, extract the path after /object/public/uploads/
      if (url.includes('/storage/v1/object/public/uploads/')) {
        const match = url.match(/\/storage\/v1\/object\/public\/uploads\/(.+)/);
        return match ? match[1] : url;
      }
      // If it's already a path (doesn't start with http), use as is
      if (!url.startsWith('http')) {
        return url;
      }
      // Fallback: try to extract path after the bucket name
      const parts = url.split('/uploads/');
      return parts.length > 1 ? parts[1] : url;
    });

    console.log('Storage paths to resolve:', storagePaths);

    // Generate signed URLs for each file
    const signedUrls: string[] = [];
    
    for (const path of storagePaths) {
      try {
        const { data: signedData, error: signError } = await supabaseAdmin
          .storage
          .from('uploads')
          .createSignedUrl(path, 3600); // 1 hour expiry

        if (signError) {
          console.error(`Error creating signed URL for ${path}:`, signError);
          continue;
        }

        if (signedData?.signedUrl) {
          signedUrls.push(signedData.signedUrl);
        }
      } catch (urlError) {
        console.error(`Exception creating signed URL for ${path}:`, urlError);
      }
    }

    console.log(`Generated ${signedUrls.length} signed URLs out of ${storagePaths.length} paths`);

    return new Response(
      JSON.stringify({ 
        success: true,
        signed_urls: signedUrls,
        count: signedUrls.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Error in resolve-submission-files:', errorMessage);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});