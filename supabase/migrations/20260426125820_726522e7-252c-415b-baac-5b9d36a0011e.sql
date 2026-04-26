-- 1. Block self-assignment of admin role on profile insert
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = user_id AND role <> 'admin'::app_role);

-- 2. Replace permissive student_details UPDATE policy with column-restricted version.
-- The existing trigger restrict_student_details_update already blocks protected
-- column changes, but the policy itself should also be tight to satisfy the linter
-- and provide defense-in-depth.
DROP POLICY IF EXISTS "Students can update login status only" ON public.student_details;
CREATE POLICY "Students can update login status only"
ON public.student_details
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = student_details.profile_id
      AND profiles.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = student_details.profile_id
      AND profiles.user_id = auth.uid()
  )
);
-- Trigger restrict_student_details_update enforces that only has_logged_in
-- can actually be modified by non-admin/non-service callers.

-- 3. Remove broad SELECT-all policy on uploads bucket. The existing scoped
-- policies (students see own, faculty see assignment submissions, admins see all)
-- remain in place and are sufficient.
DROP POLICY IF EXISTS "Anyone can read uploads" ON storage.objects;

-- 4. Make handwriting-samples bucket private.
UPDATE storage.buckets SET public = false WHERE id = 'handwriting-samples';

-- Existing RLS policies on storage.objects for handwriting-samples already
-- restrict SELECT to owner / faculty / admin, so signed URLs remain functional
-- for legitimate viewers.
