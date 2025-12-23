import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Allowed origins for CORS - restrict to your domain
const getAllowedOrigins = (): string[] => {
  const origins = [
    "http://localhost:5173",
    "http://localhost:3000",
  ];
  
  // Add production origin if available
  const productionOrigin = Deno.env.get("APP_ORIGIN");
  if (productionOrigin) {
    origins.push(productionOrigin);
  }
  
  // Add Lovable preview domains
  origins.push("https://lovable.dev");
  origins.push(/https:\/\/.*\.lovable\.app/.source);
  
  return origins;
};

const getCorsHeaders = (origin: string | null): Record<string, string> => {
  const allowedOrigins = getAllowedOrigins();
  
  // Check if origin is allowed
  let allowedOrigin = "";
  if (origin) {
    for (const allowed of allowedOrigins) {
      if (allowed === origin || (allowed.includes(".*") && new RegExp(allowed).test(origin))) {
        allowedOrigin = origin;
        break;
      }
      // Check for lovable domains
      if (origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com") || origin === "https://lovable.dev") {
        allowedOrigin = origin;
        break;
      }
    }
  }
  
  return {
    "Access-Control-Allow-Origin": allowedOrigin || getAllowedOrigins()[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
  };
};

interface StudentData {
  full_name: string;
  email: string;
  password: string;
  roll_number: string;
  year: number;
  branch: string;
  section: string;
  semester: string;
}

interface BulkCreateRequest {
  students: StudentData[];
}

// Validate password strength
const isStrongPassword = (password: string): boolean => {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
};

// Generate secure password
const generateSecurePassword = (): string => {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnpqrstuvwxyz";
  const numbers = "23456789";
  const special = "!@#$%&*";
  
  let password = "";
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  const allChars = uppercase + lowercase + numbers + special;
  for (let i = 0; i < 8; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  return password.split("").sort(() => Math.random() - 0.5).join("");
};

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

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

    // Check if user is admin
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

    const { students }: BulkCreateRequest = await req.json();
    
    // Validate input
    if (!Array.isArray(students) || students.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid request: students array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit: max 100 students per request
    if (students.length > 100) {
      return new Response(JSON.stringify({ error: "Maximum 100 students per request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = {
      success: [] as string[],
      failed: [] as { email: string; error: string }[],
    };

    for (const student of students) {
      try {
        // Validate required fields
        if (!student.email || !student.full_name || !student.roll_number) {
          results.failed.push({ email: student.email || "unknown", error: "Missing required fields" });
          continue;
        }

        // Use provided password directly (admin is responsible for password strength)
        const password = student.password;
        if (!password) {
          results.failed.push({ email: student.email, error: "Password is required" });
          continue;
        }

        // Create user in auth
        const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: student.email,
          password: password,
          email_confirm: true,
          user_metadata: {
            full_name: student.full_name,
          },
        });

        if (createError) {
          results.failed.push({ email: student.email, error: "Account creation failed" });
          continue;
        }

        if (!authData.user) {
          results.failed.push({ email: student.email, error: "User creation failed" });
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
          results.failed.push({ email: student.email, error: "Profile creation failed" });
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
            semester: student.semester || 'I',
            has_logged_in: false,
          });

        if (detailsError) {
          results.failed.push({ email: student.email, error: "Details creation failed" });
          continue;
        }

        results.success.push(student.email);
      } catch (err) {
        results.failed.push({ email: student.email, error: "Unexpected error" });
      }
    }

    console.log(`Bulk create completed: ${results.success.length} success, ${results.failed.length} failed`);

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error in bulk-create-students");
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req.headers.get("origin")), "Content-Type": "application/json" },
    });
  }
});
