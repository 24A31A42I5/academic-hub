import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  type: "assignment_graded" | "new_assignment" | "submission_flagged";
  data: {
    studentEmail?: string;
    studentName?: string;
    assignmentTitle?: string;
    marks?: number;
    feedback?: string;
    studentEmails?: string[];
    deadline?: string;
    branch?: string;
    year?: number;
    section?: string;
    semester?: string;
    riskLevel?: string;
    similarityScore?: number;
    flaggedConcerns?: string[];
  };
}

const handler = async (req: Request): Promise<Response> => {
  console.log("send-notification function invoked");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, data }: NotificationRequest = await req.json();
    console.log("Notification type:", type);
    console.log("Notification data:", JSON.stringify(data));

    if (type === "assignment_graded") {
      if (!data.studentEmail) {
        throw new Error("Student email is required for graded notification");
      }

      const emailResponse = await resend.emails.send({
        from: "Assignment Portal <onboarding@resend.dev>",
        to: [data.studentEmail],
        subject: `Your assignment "${data.assignmentTitle}" has been graded`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; padding: 30px; border-radius: 12px 12px 0 0; }
              .content { background: #f8fafc; padding: 30px; border-radius: 0 0 12px 12px; }
              .marks-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6; }
              .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">Assignment Graded!</h1>
              </div>
              <div class="content">
                <p>Hello ${data.studentName || "Student"},</p>
                <p>Your submission for <strong>"${data.assignmentTitle}"</strong> has been reviewed and graded.</p>
                
                <div class="marks-box">
                  <h3 style="margin: 0 0 10px 0;">Your Score</h3>
                  <p style="font-size: 32px; font-weight: bold; margin: 0; color: #3b82f6;">
                    ${data.marks !== undefined ? data.marks : "N/A"} marks
                  </p>
                </div>
                
                ${data.feedback ? `
                <div class="marks-box">
                  <h3 style="margin: 0 0 10px 0;">Feedback</h3>
                  <p style="margin: 0; color: #374151;">${data.feedback}</p>
                </div>
                ` : ""}
                
                <p>Log in to your portal to view more details.</p>
              </div>
              <div class="footer">
                <p>This is an automated notification from Assignment Portal.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      console.log("Grade notification sent:", emailResponse);
      return new Response(JSON.stringify({ success: true, emailResponse }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });

    } else if (type === "submission_flagged") {
      if (!data.studentEmail) {
        throw new Error("Student email is required for flagged notification");
      }

      const riskColor = data.riskLevel === 'high' ? '#dc2626' : '#f59e0b';
      const riskText = data.riskLevel === 'high' ? 'High Risk' : 'Medium Risk';

      const emailResponse = await resend.emails.send({
        from: "Assignment Portal <onboarding@resend.dev>",
        to: [data.studentEmail],
        subject: `⚠️ Your submission for "${data.assignmentTitle}" requires attention`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, ${riskColor}, #991b1b); color: white; padding: 30px; border-radius: 12px 12px 0 0; }
              .content { background: #f8fafc; padding: 30px; border-radius: 0 0 12px 12px; }
              .alert-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${riskColor}; }
              .concerns-list { background: #fef2f2; padding: 15px; border-radius: 8px; margin: 15px 0; }
              .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin: 0;">⚠️ Submission Flagged</h1>
              </div>
              <div class="content">
                <p>Hello ${data.studentName || "Student"},</p>
                <p>Your submission for <strong>"${data.assignmentTitle}"</strong> has been flagged by our AI verification system.</p>
                
                <div class="alert-box">
                  <h3 style="margin: 0 0 10px 0; color: ${riskColor};">${riskText} Detection</h3>
                  <p style="margin: 0;">Our system detected potential discrepancies between your submission and your registered handwriting sample.</p>
                  ${data.similarityScore !== undefined ? `
                  <p style="margin: 10px 0 0 0; font-size: 14px; color: #6b7280;">
                    Similarity Score: ${data.similarityScore}%
                  </p>
                  ` : ''}
                </div>
                
                ${data.flaggedConcerns && data.flaggedConcerns.length > 0 ? `
                <div class="concerns-list">
                  <h4 style="margin: 0 0 10px 0; color: #991b1b;">Concerns Identified:</h4>
                  <ul style="margin: 0; padding-left: 20px;">
                    ${data.flaggedConcerns.map(c => `<li style="color: #374151; margin-bottom: 5px;">${c}</li>`).join('')}
                  </ul>
                </div>
                ` : ''}
                
                <div class="alert-box" style="border-left-color: #3b82f6;">
                  <h3 style="margin: 0 0 10px 0; color: #3b82f6;">What happens next?</h3>
                  <ul style="margin: 0; padding-left: 20px; color: #374151;">
                    <li>Your submission will be reviewed by your faculty</li>
                    <li>If this was a mistake, no action is required</li>
                    <li>You may be asked to provide additional verification</li>
                  </ul>
                </div>
                
                <p style="color: #6b7280; font-size: 14px;">
                  If you believe this is an error, please contact your faculty directly.
                </p>
              </div>
              <div class="footer">
                <p>This is an automated notification from Assignment Portal.</p>
              </div>
            </div>
          </body>
          </html>
        `,
      });

      console.log("Flagged notification sent:", emailResponse);
      return new Response(JSON.stringify({ success: true, emailResponse }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });

    } else if (type === "new_assignment") {
      if (!data.studentEmails || data.studentEmails.length === 0) {
        console.log("No student emails provided, skipping notification");
        return new Response(JSON.stringify({ success: true, message: "No students to notify" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const batchSize = 50;
      const batches = [];
      for (let i = 0; i < data.studentEmails.length; i += batchSize) {
        batches.push(data.studentEmails.slice(i, i + batchSize));
      }

      const results = [];
      for (const batch of batches) {
        const emailResponse = await resend.emails.send({
          from: "Assignment Portal <onboarding@resend.dev>",
          to: batch,
          subject: `New Assignment: ${data.assignmentTitle}`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; border-radius: 12px 12px 0 0; }
                .content { background: #f8fafc; padding: 30px; border-radius: 0 0 12px 12px; }
                .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 20px; font-size: 14px; margin-right: 8px; }
                .deadline { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 4px; margin: 20px 0; }
                .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 20px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1 style="margin: 0;">New Assignment Posted!</h1>
                </div>
                <div class="content">
                  <h2 style="margin-top: 0;">${data.assignmentTitle}</h2>
                  
                  <div class="info-box">
                    <span class="badge">Year ${data.year}</span>
                    <span class="badge">Sem ${data.semester || 'I'}</span>
                    <span class="badge">${data.branch}</span>
                    <span class="badge">Section ${data.section}</span>
                  </div>
                  
                  <div class="deadline">
                    <strong>⏰ Deadline:</strong> ${data.deadline ? new Date(data.deadline).toLocaleString() : 'Check portal for details'}
                  </div>
                  
                  <p>A new assignment has been posted for your class. Please log in to your portal to view the details and submit your work before the deadline.</p>
                </div>
                <div class="footer">
                  <p>This is an automated notification from Assignment Portal.</p>
                </div>
              </div>
            </body>
            </html>
          `,
        });
        results.push(emailResponse);
      }

      console.log("New assignment notifications sent:", results);
      return new Response(JSON.stringify({ success: true, results }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    throw new Error("Invalid notification type");
  } catch (error: any) {
    console.error("Error in send-notification function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
