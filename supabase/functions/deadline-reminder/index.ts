import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req: Request) => {
  console.log("deadline-reminder function invoked at", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find assignments with deadlines between now and 25 hours from now
    // This gives us a 1-hour window to catch assignments due in ~24 hours
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    console.log("Checking for assignments due between:", in24Hours.toISOString(), "and", in25Hours.toISOString());

    // Get assignments due in ~24 hours
    const { data: upcomingAssignments, error: assignmentsError } = await supabase
      .from("assignments")
      .select("id, title, deadline, year, branch, section")
      .gte("deadline", in24Hours.toISOString())
      .lte("deadline", in25Hours.toISOString());

    if (assignmentsError) {
      console.error("Error fetching assignments:", assignmentsError);
      throw assignmentsError;
    }

    if (!upcomingAssignments || upcomingAssignments.length === 0) {
      console.log("No assignments due in the next 24-25 hours");
      return new Response(
        JSON.stringify({ success: true, message: "No reminders needed", count: 0 }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Found ${upcomingAssignments.length} assignment(s) due soon`);

    let totalReminders = 0;

    for (const assignment of upcomingAssignments) {
      console.log(`Processing assignment: ${assignment.title} (${assignment.id})`);

      // Get students who have NOT submitted this assignment
      // First, get all student profile IDs who have submitted
      const { data: submissions, error: subError } = await supabase
        .from("submissions")
        .select("student_profile_id")
        .eq("assignment_id", assignment.id);

      if (subError) {
        console.error("Error fetching submissions:", subError);
        continue;
      }

      const submittedProfileIds = new Set((submissions || []).map(s => s.student_profile_id));

      // Get all students in this section who haven't submitted
      const { data: students, error: studentsError } = await supabase
        .from("profiles")
        .select(`
          id,
          email,
          full_name,
          phone_number,
          student_details!inner (
            year,
            branch,
            section,
            phone_number
          )
        `)
        .eq("role", "student")
        .eq("student_details.year", assignment.year)
        .eq("student_details.branch", assignment.branch)
        .eq("student_details.section", assignment.section);

      if (studentsError) {
        console.error("Error fetching students:", studentsError);
        continue;
      }

      // Filter to only those who haven't submitted
      const studentsToRemind = (students || []).filter(s => !submittedProfileIds.has(s.id));

      if (studentsToRemind.length === 0) {
        console.log(`All students have submitted for assignment: ${assignment.title}`);
        continue;
      }

      console.log(`Sending reminders to ${studentsToRemind.length} student(s) for assignment: ${assignment.title}`);

      // Calculate hours remaining
      const deadlineDate = new Date(assignment.deadline);
      const hoursRemaining = Math.round((deadlineDate.getTime() - now.getTime()) / (60 * 60 * 1000));

      // Extract emails and phone numbers
      const studentEmails = studentsToRemind.map(s => s.email).filter(Boolean);
      const studentPhones = studentsToRemind.map(s => {
        const details = s.student_details;
        if (Array.isArray(details) && details[0]) {
          return details[0].phone_number || s.phone_number;
        }
        return s.phone_number;
      }).filter(Boolean);

      // Call send-notification function
      try {
        const notifyResponse = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            type: "deadline_reminder",
            data: {
              studentEmails,
              studentPhones,
              assignmentTitle: assignment.title,
              deadline: assignment.deadline,
              year: assignment.year,
              branch: assignment.branch,
              section: assignment.section,
              hoursRemaining,
              assignmentId: assignment.id,
            },
          }),
        });

        const result = await notifyResponse.json();
        console.log(`Notification result for ${assignment.title}:`, result);
        totalReminders += studentEmails.length;
      } catch (notifyError) {
        console.error(`Error sending notifications for ${assignment.title}:`, notifyError);
      }
    }

    console.log(`Deadline reminder job completed. Total reminders sent: ${totalReminders}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Sent ${totalReminders} deadline reminders`,
        count: totalReminders,
        assignmentsProcessed: upcomingAssignments.length
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in deadline-reminder function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
