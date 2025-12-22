import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StudentData {
  full_name: string;
  email: string;
  password: string;
  roll_number: string;
  year: number;
  branch: string;
  section: string;
}

interface BulkCreateRequest {
  students: StudentData[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Create admin client with service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the request is from an authenticated admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
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

    // Check if user is admin
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only admins can bulk create students" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { students }: BulkCreateRequest = await req.json();
    
    const results = {
      success: [] as string[],
      failed: [] as { email: string; error: string }[],
    };

    for (const student of students) {
      try {
        // Create user in auth
        const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: student.email,
          password: student.password,
          email_confirm: true,
          user_metadata: {
            full_name: student.full_name,
          },
        });

        if (createError) {
          results.failed.push({ email: student.email, error: createError.message });
          continue;
        }

        if (!authData.user) {
          results.failed.push({ email: student.email, error: "Failed to create user" });
          continue;
        }

        // Create profile
        const { data: profileData, error: profileError } = await supabaseAdmin
          .from("profiles")
          .insert({
            user_id: authData.user.id,
            email: student.email,
            full_name: student.full_name,
            role: "student",
          })
          .select()
          .single();

        if (profileError) {
          results.failed.push({ email: student.email, error: `Profile error: ${profileError.message}` });
          continue;
        }

        // Create user role
        await supabaseAdmin.from("user_roles").insert({
          user_id: authData.user.id,
          role: "student",
        });

        // Create student details
        const { error: detailsError } = await supabaseAdmin
          .from("student_details")
          .insert({
            profile_id: profileData.id,
            roll_number: student.roll_number,
            year: student.year,
            branch: student.branch,
            section: student.section,
            has_logged_in: false,
          });

        if (detailsError) {
          results.failed.push({ email: student.email, error: `Details error: ${detailsError.message}` });
          continue;
        }

        results.success.push(student.email);
      } catch (err) {
        results.failed.push({ email: student.email, error: String(err) });
      }
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in bulk-create-students:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
