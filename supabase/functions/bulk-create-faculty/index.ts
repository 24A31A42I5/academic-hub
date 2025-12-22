import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const getCorsHeaders = (origin: string | null): Record<string, string> => {
  let allowedOrigin = "";
  if (origin) {
    if (origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com") || origin === "https://lovable.dev" || origin.startsWith("http://localhost")) {
      allowedOrigin = origin;
    }
  }
  
  return {
    "Access-Control-Allow-Origin": allowedOrigin || "http://localhost:5173",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
  };
};

interface FacultyData {
  full_name: string;
  email: string;
  password: string;
  faculty_id: string;
}

interface BulkCreateRequest {
  faculty: FacultyData[];
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { faculty }: BulkCreateRequest = await req.json();
    
    if (!Array.isArray(faculty) || faculty.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid request: faculty array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (faculty.length > 100) {
      return new Response(JSON.stringify({ error: "Maximum 100 faculty per request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = {
      success: [] as string[],
      failed: [] as { email: string; error: string }[],
    };

    for (const f of faculty) {
      try {
        if (!f.email || !f.full_name || !f.faculty_id || !f.password) {
          results.failed.push({ email: f.email || "unknown", error: "Missing required fields" });
          continue;
        }

        // Create user
        const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: f.email,
          password: f.password,
          email_confirm: true,
          user_metadata: {
            full_name: f.full_name,
          },
        });

        if (createError) {
          console.log(`Error creating user ${f.email}:`, createError.message);
          results.failed.push({ email: f.email, error: "Account creation failed" });
          continue;
        }

        if (!authData.user) {
          results.failed.push({ email: f.email, error: "User creation failed" });
          continue;
        }

        // Create profile
        const { data: profileData, error: profileError } = await supabaseAdmin
          .from("profiles")
          .insert({
            user_id: authData.user.id,
            email: f.email,
            full_name: f.full_name,
            role: "faculty",
          })
          .select()
          .single();

        if (profileError) {
          console.log(`Error creating profile for ${f.email}:`, profileError.message);
          results.failed.push({ email: f.email, error: "Profile creation failed" });
          continue;
        }

        // Create user role
        await supabaseAdmin.from("user_roles").insert({
          user_id: authData.user.id,
          role: "faculty",
        });

        // Create faculty details
        const { error: detailsError } = await supabaseAdmin
          .from("faculty_details")
          .insert({
            profile_id: profileData.id,
            faculty_id: f.faculty_id,
          });

        if (detailsError) {
          console.log(`Error creating details for ${f.email}:`, detailsError.message);
          results.failed.push({ email: f.email, error: "Details creation failed" });
          continue;
        }

        results.success.push(f.email);
      } catch (err) {
        console.log(`Unexpected error for ${f.email}:`, err);
        results.failed.push({ email: f.email, error: "Unexpected error" });
      }
    }

    console.log(`Bulk faculty create: ${results.success.length} success, ${results.failed.length} failed`);

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in bulk-create-faculty:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }
});
