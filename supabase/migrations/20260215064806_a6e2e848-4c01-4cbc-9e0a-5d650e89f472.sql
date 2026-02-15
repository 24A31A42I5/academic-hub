-- Fix: Allow students to re-upload submissions that haven't been graded yet
-- The old policy required status='pending', which blocks re-uploads after verification
-- changes status to 'needs_manual_review' or 'verified'. 
-- The fix: allow updates as long as marks IS NULL (not yet graded by faculty).

DROP POLICY IF EXISTS "Students can update ungraded submissions" ON public.submissions;

CREATE POLICY "Students can update ungraded submissions" 
ON public.submissions 
FOR UPDATE 
USING (
  (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = submissions.student_profile_id) AND (profiles.user_id = auth.uid()))))
  AND (marks IS NULL)
)
WITH CHECK (
  (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = submissions.student_profile_id) AND (profiles.user_id = auth.uid()))))
  AND (marks IS NULL)
);