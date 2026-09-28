/**
 * v8 enrollment: one camera-captured sample per call.
 * - Identity comes from the JWT, never from the request body.
 * - The sample path must live under the caller's own storage folder.
 * - Accepted samples are stored in handwriting_samples; once >= 3 exist the
 *   consolidated profile is written to student_details.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { z } from "npm:zod@3.23.8";
import { analyzeHandwriting } from "../_shared/handwriting/analysisService.ts";
import { createLovableGeminiProvider } from "../_shared/handwriting/provider.ts";
import { MAX_ENROLLMENT_SAMPLES, MIN_ENROLLMENT_SAMPLES, MIN_EXTRACTION_CONFIDENCE } from "../_shared/handwriting/config.ts";
import { SCHEMA_VERSION, UNKNOWN, type ExtractedProfile, type FeatureName } from "../_shared/handwriting/schema.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'handwriting-samples';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const BodySchema = z.object({
  action: z.enum(['enroll', 'rebuild']).default('enroll'),
  storage_path: z.string().min(3).max(300).optional(),
  quality_metrics: z.record(z.unknown()).optional(),
});

async function sha256Hex(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Consolidated profile: per-feature mode + variability across samples. */
function consolidate(samples: Array<{ id: string; extracted_features: ExtractedProfile }>) {
  const feats = Object.keys(samples[0].extracted_features.features) as FeatureName[];
  const consensus: Record<string, string> = {};
  const variability: Record<string, number> = {};
  for (const f of feats) {
    const vals = samples.map((s) => s.extracted_features.features[f]).filter((v) => v && v !== UNKNOWN);
    if (!vals.length) { consensus[f] = UNKNOWN; continue; }
    const counts = new Map<string, number>();
    vals.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
    const [mode, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    consensus[f] = mode;
    variability[f] = Number((1 - n / vals.length).toFixed(2));
  }
  return {
    version: SCHEMA_VERSION,
    sample_count: samples.length,
    sample_ids: samples.map((s) => s.id),
    consensus_features: consensus,
    feature_variability: variability,
    mean_confidence: Number((samples.reduce((s, x) => s + x.extracted_features.overall_confidence, 0) / samples.length).toFixed(3)),
    trained_at: new Date().toISOString(),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Unauthorized' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    let userId: string | null = null;
    try {
      const authClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
      const { data } = await authClient.auth.getClaims(token);
      userId = (data?.claims?.sub as string | undefined) ?? null;
    } catch { /* fall through */ }
    if (!userId) userId = (await admin.auth.getUser(token)).data.user?.id ?? null;
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: 'Invalid request' }, 400);
    const { action, storage_path, quality_metrics } = parsed.data;

    const { data: profile } = await admin.from('profiles').select('id, role').eq('user_id', userId).single();
    if (!profile || profile.role !== 'student') return json({ error: 'Only students can enroll handwriting samples.' }, 403);
    const { data: details } = await admin.from('student_details').select('id').eq('profile_id', profile.id).single();
    if (!details) return json({ error: 'Student record not found.' }, 404);

    const rebuildProfile = async () => {
      const { data: accepted } = await admin.from('handwriting_samples')
        .select('id, storage_path, extracted_features, created_at')
        .eq('student_profile_id', profile.id).eq('status', 'accepted').order('created_at');
      const count = accepted?.length ?? 0;
      const update: Record<string, unknown> = { handwriting_sample_count: count, handwriting_profile_version: SCHEMA_VERSION };
      if (count >= MIN_ENROLLMENT_SAMPLES) {
        update.handwriting_feature_embedding = consolidate(accepted as never);
        update.handwriting_features_extracted_at = new Date().toISOString();
      } else {
        update.handwriting_feature_embedding = null;
        update.handwriting_features_extracted_at = null;
      }
      if (count > 0) {
        update.handwriting_url = accepted![0].storage_path;
        update.handwriting_submitted_at = accepted![0].created_at;
      }
      const { error } = await admin.from('student_details').update(update).eq('id', details.id);
      if (error) throw new Error('Failed to save handwriting profile.');
      return count;
    };

    if (action === 'rebuild') {
      const count = await rebuildProfile();
      return json({ success: true, sample_count: count, profile_ready: count >= MIN_ENROLLMENT_SAMPLES });
    }

    // ---------- enroll ----------
    if (!storage_path) return json({ error: 'storage_path is required' }, 400);
    // Only the caller's own folder, no traversal.
    if (!storage_path.startsWith(`${userId}/samples/`) || storage_path.includes('..')) {
      return json({ error: 'Access denied for this file.' }, 403);
    }

    const { count: acceptedCount } = await admin.from('handwriting_samples')
      .select('id', { count: 'exact', head: true })
      .eq('student_profile_id', profile.id).eq('status', 'accepted');
    if ((acceptedCount ?? 0) >= MAX_ENROLLMENT_SAMPLES) {
      return json({ error: `You already have ${MAX_ENROLLMENT_SAMPLES} enrollment samples.` }, 409);
    }

    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(storage_path);
    if (dlErr || !blob) return json({ error: 'Could not read the captured image from storage. Please capture again.' }, 502);
    const buf = await blob.arrayBuffer();
    const imageHash = await sha256Hex(buf);

    const reject = async (status: number, error: string, code: string) => {
      await admin.storage.from(BUCKET).remove([storage_path]);
      return json({ error, code }, status);
    };

    const { data: dup } = await admin.from('handwriting_samples').select('student_profile_id').eq('image_hash', imageHash).limit(1);
    if (dup?.length) {
      return reject(409, dup[0].student_profile_id === profile.id
        ? 'This exact image is already one of your samples. Capture a new page.'
        : 'This image is already registered to another account.', 'duplicate');
    }

    const result = await analyzeHandwriting(createLovableGeminiProvider(Deno.env.get('LOVABLE_API_KEY')), encode(buf));
    if (!result.ok) {
      // Processing failure — never treated as a handwriting judgement.
      const status = result.error_type === 'rate_limit' ? 429 : result.error_type === 'credits' ? 402 : 503;
      return reject(status, result.message, result.error_type);
    }
    const p = result.profile;
    if (!p.is_handwritten || p.quality_status === 'not_handwriting') return reject(422, 'This page does not look handwritten. Write the sample text by hand and capture it again.', 'not_handwriting');
    if (p.quality_status === 'insufficient_handwriting') return reject(422, 'Not enough handwriting on the page. Fill the page with the sample text and capture again.', 'insufficient_handwriting');
    if (p.quality_status !== 'ok' || p.overall_confidence < MIN_EXTRACTION_CONFIDENCE) return reject(422, 'Please capture a clearer handwriting sample (better light, hold steady, whole page in frame).', 'low_confidence');

    const { data: row, error: insErr } = await admin.from('handwriting_samples').insert({
      student_profile_id: profile.id,
      storage_path,
      image_hash: imageHash,
      quality_metrics: quality_metrics ?? null,
      extracted_features: p,
      extraction_confidence: p.overall_confidence,
      status: 'accepted',
      schema_version: SCHEMA_VERSION,
    }).select('id').single();
    if (insErr) {
      console.error('insert sample failed', insErr);
      return reject(500, 'Could not save the sample. Please try again.', 'db_error');
    }

    const count = await rebuildProfile();
    return json({
      success: true,
      sample_id: row.id,
      sample_count: count,
      profile_ready: count >= MIN_ENROLLMENT_SAMPLES,
      extraction_confidence: p.overall_confidence,
    });
  } catch (error) {
    console.error('extract-handwriting-features error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
