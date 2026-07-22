
-- Fix: Faculty should not see other faculty's private details.
-- The misnamed policy 'Faculty can view student details' on public.faculty_details
-- currently lets any faculty read all faculty records. Remove it; faculty already
-- see their own via 'Faculty can view their own details', admins via their own policy.
DROP POLICY IF EXISTS "Faculty can view student details" ON public.faculty_details;

-- Fix: Storage policies for submission files were too broad — any faculty could
-- read every student's submission. Scope reads to files whose <assignment_id>
-- (second folder segment) belongs to the current faculty user.
DROP POLICY IF EXISTS "Faculty can view student submission files" ON storage.objects;
DROP POLICY IF EXISTS "Faculty can view submissions" ON storage.objects;

CREATE POLICY "Faculty can view own assignment submission files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'uploads'
  AND public.has_role(auth.uid(), 'faculty'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.assignments a
    JOIN public.profiles p ON p.id = a.faculty_profile_id
    WHERE p.user_id = auth.uid()
      AND a.id::text = (storage.foldername(name))[2]
  )
);
