
-- Drop the recursive policy
DROP POLICY IF EXISTS "Faculty can view student profiles in their sections" ON public.profiles;

-- Recreate without self-referencing profiles table
CREATE POLICY "Faculty can view student profiles in their sections"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'faculty'::app_role)
  AND EXISTS (
    SELECT 1
    FROM student_details sd
    JOIN faculty_sections fs ON (fs.year = sd.year AND fs.branch = sd.branch AND fs.section = sd.section)
    WHERE fs.faculty_profile_id = (
      SELECT p2.id FROM public.profiles p2 WHERE p2.user_id = auth.uid() LIMIT 1
    )
    AND sd.profile_id = profiles.id
  )
);
