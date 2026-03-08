
-- ============================================================
-- FIX 1: Students can only update `has_logged_in` on their own row
-- (prevents overwriting handwriting data, branch, section, etc.)
-- ============================================================
DROP POLICY IF EXISTS "Students can update their login status" ON public.student_details;

CREATE POLICY "Students can update login status only"
ON public.student_details
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = student_details.profile_id
      AND profiles.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = student_details.profile_id
      AND profiles.user_id = auth.uid()
  )
);

-- Restrict student updates to only has_logged_in column
-- We do this by revoking column-level UPDATE and granting only has_logged_in
-- Since Postgres RLS can't restrict columns directly, we use a trigger instead

CREATE OR REPLACE FUNCTION public.restrict_student_details_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- If the caller is the service role, allow everything
  IF current_setting('request.jwt.claims', true)::json->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  
  -- Check if the user is an admin
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- For students: only allow has_logged_in to change
  IF NEW.handwriting_feature_embedding IS DISTINCT FROM OLD.handwriting_feature_embedding
    OR NEW.handwriting_url IS DISTINCT FROM OLD.handwriting_url
    OR NEW.handwriting_image_hash IS DISTINCT FROM OLD.handwriting_image_hash
    OR NEW.handwriting_submitted_at IS DISTINCT FROM OLD.handwriting_submitted_at
    OR NEW.handwriting_features_extracted_at IS DISTINCT FROM OLD.handwriting_features_extracted_at
    OR NEW.roll_number IS DISTINCT FROM OLD.roll_number
    OR NEW.branch IS DISTINCT FROM OLD.branch
    OR NEW.section IS DISTINCT FROM OLD.section
    OR NEW.year IS DISTINCT FROM OLD.year
    OR NEW.semester IS DISTINCT FROM OLD.semester
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
  THEN
    RAISE EXCEPTION 'Students cannot modify protected fields';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restrict_student_details_update_trigger ON public.student_details;
CREATE TRIGGER restrict_student_details_update_trigger
  BEFORE UPDATE ON public.student_details
  FOR EACH ROW
  EXECUTE FUNCTION public.restrict_student_details_update();

-- ============================================================
-- FIX 2: Students can only update file fields on ungraded submissions
-- (prevents overwriting AI scores, risk levels, status, etc.)
-- ============================================================
DROP POLICY IF EXISTS "Students can update ungraded submissions" ON public.submissions;

CREATE POLICY "Students can update ungraded submissions"
ON public.submissions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = submissions.student_profile_id
      AND profiles.user_id = auth.uid()
  )
  AND marks IS NULL
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = submissions.student_profile_id
      AND profiles.user_id = auth.uid()
  )
  AND marks IS NULL
);

-- Trigger to prevent students from modifying AI/grading fields
CREATE OR REPLACE FUNCTION public.restrict_submission_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Service role can do anything
  IF current_setting('request.jwt.claims', true)::json->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  
  -- Admins and faculty can do anything
  IF has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'faculty') THEN
    RETURN NEW;
  END IF;

  -- Students cannot modify AI analysis or grading fields
  IF NEW.ai_similarity_score IS DISTINCT FROM OLD.ai_similarity_score
    OR NEW.ai_confidence_score IS DISTINCT FROM OLD.ai_confidence_score
    OR NEW.ai_risk_level IS DISTINCT FROM OLD.ai_risk_level
    OR NEW.ai_flagged_sections IS DISTINCT FROM OLD.ai_flagged_sections
    OR NEW.ai_analysis_details IS DISTINCT FROM OLD.ai_analysis_details
    OR NEW.page_verification_results IS DISTINCT FROM OLD.page_verification_results
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
    OR NEW.feedback IS DISTINCT FROM OLD.feedback
    OR NEW.marks IS DISTINCT FROM OLD.marks
  THEN
    RAISE EXCEPTION 'Students cannot modify AI analysis or grading fields';
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restrict_submission_update_trigger ON public.submissions;
CREATE TRIGGER restrict_submission_update_trigger
  BEFORE UPDATE ON public.submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.restrict_submission_update();

-- ============================================================
-- FIX 3: Faculty can only view profiles of students in their sections
-- ============================================================
DROP POLICY IF EXISTS "Faculty can view student profiles in their sections" ON public.profiles;

CREATE POLICY "Faculty can view student profiles in their sections"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  -- Faculty can see profiles of students in sections they are assigned to
  has_role(auth.uid(), 'faculty'::app_role)
  AND (
    EXISTS (
      SELECT 1
      FROM student_details sd
      JOIN faculty_sections fs ON (
        fs.year = sd.year
        AND fs.branch = sd.branch
        AND fs.section = sd.section
      )
      JOIN profiles fp ON fp.id = fs.faculty_profile_id
      WHERE fp.user_id = auth.uid()
        AND sd.profile_id = profiles.id
    )
  )
);

-- ============================================================
-- FIX 4: Restrict feature_statistics to admin-only reads
-- (ML weights should not be visible to students)
-- ============================================================
DROP POLICY IF EXISTS "Anyone can read feature statistics" ON public.feature_statistics;

CREATE POLICY "Service and admin can read feature statistics"
ON public.feature_statistics
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
);
