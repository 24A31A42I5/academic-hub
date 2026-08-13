-- 1. Assignments: faculty must own the row AND be assigned to that section
DROP POLICY IF EXISTS "Faculty can manage their assignments" ON public.assignments;

CREATE OR REPLACE FUNCTION public.faculty_owns_section(_faculty_profile_id uuid, _year integer, _branch text, _section text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.faculty_sections fs
    JOIN public.profiles p ON p.id = fs.faculty_profile_id
    WHERE fs.faculty_profile_id = _faculty_profile_id
      AND p.user_id = auth.uid()
      AND fs.year = _year
      AND fs.branch = _branch
      AND fs.section = _section
  )
$$;

GRANT EXECUTE ON FUNCTION public.faculty_owns_section(uuid, integer, text, text) TO authenticated;

CREATE POLICY "Faculty can view their assignments"
ON public.assignments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = assignments.faculty_profile_id AND p.user_id = auth.uid()));

CREATE POLICY "Faculty can create assignments for assigned sections"
ON public.assignments FOR INSERT TO authenticated
WITH CHECK (public.faculty_owns_section(faculty_profile_id, year, branch, section));

CREATE POLICY "Faculty can update assignments for assigned sections"
ON public.assignments FOR UPDATE TO authenticated
USING (public.faculty_owns_section(faculty_profile_id, year, branch, section))
WITH CHECK (public.faculty_owns_section(faculty_profile_id, year, branch, section));

CREATE POLICY "Faculty can delete assignments for assigned sections"
ON public.assignments FOR DELETE TO authenticated
USING (public.faculty_owns_section(faculty_profile_id, year, branch, section));

-- 2. Handwriting storage: scope faculty reads to their own sections
DROP POLICY IF EXISTS "Faculty can view student handwriting" ON storage.objects;

CREATE POLICY "Faculty can view handwriting for their sections"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'handwriting-samples'
  AND public.has_role(auth.uid(), 'faculty')
  AND EXISTS (
    SELECT 1
    FROM public.profiles sp
    WHERE sp.user_id::text = (storage.foldername(storage.objects.name))[1]
      AND public.faculty_can_view_profile(auth.uid(), sp.id)
  )
);

-- 3. Revoke unused SECURITY DEFINER helpers from signed-in users
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.get_profile_id_for_user(uuid) FROM authenticated, anon, public;