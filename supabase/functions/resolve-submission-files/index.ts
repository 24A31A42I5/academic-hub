import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

// Resolves stored submission file references (paths or legacy URLs) into fresh signed URLs.
// This avoids broken previews for private storage and prevents expired signed-URL issues.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UPLOADS_BUCKET = "uploads";
const DEFAULT_EXPIRES_IN = 60 * 60; // 1 hour

function refToUploadsPath(ref: string): string | null {
  const trimmed = (ref || "").trim();
  if (!trimmed) return null;

  // If it's already a plain storage path (preferred).
  if (!trimmed.startsWith("http") && !trimmed.startsWith("uploads/")) return trimmed;

  // If someone stored a bucket-prefixed path.
  if (trimmed.startsWith("uploads/")) return trimmed.replace(/^uploads\//, "");

  // Legacy: stored as URL from getPublicUrl() or some signed URL.
  // Attempt to extract everything after `/uploads/`.
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/uploads\/(.+)$/);
    return match?.[1] ?? null;
  } catch {
    const match = trimmed.match(/\/uploads\/(.+)$/);
    return match?.[1] ?? null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { submission_id, expires_in } = await req.json();
    if (!submission_id) {
      return new Response(JSON.stringify({ error: "Missing submission_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User-scoped client (enforces RLS). If they can't see this submission, this will fail.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Ensure token is valid.
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: submission, error: subError } = await userClient
      .from("submissions")
      .select("id,file_url,file_urls")
      .eq("id", submission_id)
      .single();

    if (subError || !submission) {
      return new Response(
        JSON.stringify({ error: "Submission not found or access denied" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const refs: string[] =
      Array.isArray(submission.file_urls) && submission.file_urls.length > 0
        ? submission.file_urls
        : submission.file_url
          ? [submission.file_url]
          : [];

    const paths = refs.map(refToUploadsPath).filter((p): p is string => !!p);
    if (paths.length === 0) {
      return new Response(JSON.stringify({ error: "No files found for this submission" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expiresIn =
      typeof expires_in === "number" && expires_in > 0
        ? Math.min(expires_in, 24 * 60 * 60)
        : DEFAULT_EXPIRES_IN;

    // Service-role client can sign URLs for private storage.
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: signed, error: signedError } = await serviceClient.storage
      .from(UPLOADS_BUCKET)
      .createSignedUrls(paths, expiresIn);

    if (signedError) {
      throw signedError;
    }

    const signed_urls = (signed || [])
      .map((s: any) => s?.signedUrl)
      .filter((u: any): u is string => typeof u === "string" && u.length > 0);

    return new Response(
      JSON.stringify({ success: true, signed_urls, paths, expires_in: expiresIn }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in resolve-submission-files:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
