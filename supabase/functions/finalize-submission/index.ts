import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  try {
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return response({ error: 'Unauthorized' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: auth } = await admin.auth.getUser(token);
    if (!auth.user) return response({ error: 'Unauthorized' }, 401);
    const { submission_id } = await req.json().catch(() => ({}));
    if (!submission_id) return response({ error: 'submission_id is required' }, 400);
    const { data: caller } = await admin.from('profiles').select('id, role').eq('user_id', auth.user.id).single();
    const { data: submission } = await admin.from('submissions').select('id, student_profile_id, status, ai_similarity_score, verified_at, finalized_at').eq('id', submission_id).single();
    if (!caller || !submission) return response({ error: 'Not found' }, 404);
    if (caller.role !== 'admin' && caller.id !== submission.student_profile_id) return response({ error: 'Forbidden' }, 403);
    if (!submission.verified_at || submission.ai_similarity_score === null) return response({ error: 'A consistency result is required before final submission.' }, 409);
    if (submission.finalized_at) return response({ success: true, finalized_at: submission.finalized_at });
    const finalizedAt = new Date().toISOString();
    const { error } = await admin.from('submissions').update({ finalized_at: finalizedAt, finalized_by_student: caller.role === 'student' }).eq('id', submission_id).is('finalized_at', null);
    if (error) throw error;
    return response({ success: true, finalized_at: finalizedAt });
  } catch (error) {
    console.error('finalize-submission error', error);
    return response({ error: error instanceof Error ? error.message : 'Finalization failed' }, 500);
  }
});