
-- Fix 1: Drop every possible variant of student submissions UPDATE policy
DROP POLICY IF EXISTS "Students can update own submissions" ON public.submissions;
DROP POLICY IF EXISTS "Students can update their own submissions" ON public.submissions;
DROP POLICY IF EXISTS "Students can update own ungraded submissions" ON public.submissions;
DROP POLICY IF EXISTS "Students can update ungraded submissions" ON public.submissions;

-- Recreate with correct conditions: students can update only their own where marks IS NULL
CREATE POLICY "Students can update ungraded submissions"
  ON public.submissions
  FOR UPDATE
  USING (
    (EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = submissions.student_profile_id
      AND profiles.user_id = auth.uid()
    ))
    AND marks IS NULL
  )
  WITH CHECK (
    (EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = submissions.student_profile_id
      AND profiles.user_id = auth.uid()
    ))
    AND marks IS NULL
  );
