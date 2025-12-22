-- ===========================================
-- FIX 1: PRIVILEGE ESCALATION - Block direct role inserts
-- ===========================================

-- Drop the overpermissive policy that allows users to insert any role
DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;

-- Block all direct inserts - roles must be assigned via service role (edge functions/admin)
CREATE POLICY "Block direct role inserts" ON public.user_roles
  FOR INSERT WITH CHECK (false);

-- ===========================================
-- FIX 2: STORAGE POLICIES - Enable student/faculty access
-- ===========================================

-- Drop existing admin-only policies
DROP POLICY IF EXISTS "Admin can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Admin can view files" ON storage.objects;
DROP POLICY IF EXISTS "Admin can delete files" ON storage.objects;

-- Allow students to upload submission files (folder: submissions/{user_id}/)
CREATE POLICY "Students can upload submissions"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'uploads' AND
  (storage.foldername(name))[1] = 'submissions' AND
  auth.uid()::text = (storage.foldername(name))[2]
);

-- Allow students to view their own submissions
CREATE POLICY "Students can view own submissions"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'uploads' AND
  (storage.foldername(name))[1] = 'submissions' AND
  auth.uid()::text = (storage.foldername(name))[2]
);

-- Allow faculty to view all submissions (for grading)
CREATE POLICY "Faculty can view submissions"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'uploads' AND
  (storage.foldername(name))[1] = 'submissions' AND
  public.has_role(auth.uid(), 'faculty'::app_role)
);

-- Allow admins full access to uploads bucket
CREATE POLICY "Admins can manage all files"
ON storage.objects
FOR ALL
TO authenticated
USING (
  bucket_id = 'uploads' AND
  public.has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  bucket_id = 'uploads' AND
  public.has_role(auth.uid(), 'admin'::app_role)
);

-- ===========================================
-- FIX 3: SUBMISSION DATA INTEGRITY - Prevent student tampering
-- ===========================================

-- Drop the overpermissive ALL policy for students
DROP POLICY IF EXISTS "Students can manage their own submissions" ON public.submissions;

-- Allow students to INSERT new submissions
CREATE POLICY "Students can create submissions" ON public.submissions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = submissions.student_profile_id AND profiles.user_id = auth.uid())
  );

-- Allow students to SELECT/view their own submissions
CREATE POLICY "Students can view own submissions" ON public.submissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = submissions.student_profile_id AND profiles.user_id = auth.uid())
  );

-- Allow students to UPDATE only ungraded pending submissions (for resubmission)
CREATE POLICY "Students can update ungraded submissions" ON public.submissions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = submissions.student_profile_id AND profiles.user_id = auth.uid())
    AND status = 'pending'
    AND marks IS NULL
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = submissions.student_profile_id AND profiles.user_id = auth.uid())
    AND status = 'pending'
    AND marks IS NULL
  );