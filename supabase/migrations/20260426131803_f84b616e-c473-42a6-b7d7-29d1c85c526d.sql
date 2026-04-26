-- Allow students to SELECT their own files in uploads bucket using <uid>/... path pattern
-- This was missing after the "Anyone can read uploads" policy was dropped, breaking upsert flows
CREATE POLICY "Students can view their own files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'uploads'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- Allow faculty to SELECT student submission files (path: <student_uid>/<assignment_id>/...)
-- so they can preview submitted assignments via signed URLs
CREATE POLICY "Faculty can view student submission files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'uploads'
  AND has_role(auth.uid(), 'faculty'::app_role)
);