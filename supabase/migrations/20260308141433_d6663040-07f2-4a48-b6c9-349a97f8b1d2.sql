
-- Create a security definer function to get profile_id without triggering RLS
CREATE OR REPLACE FUNCTION public.get_profile_id_for_user(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT id FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;

-- Drop the still-recursive policy
DROP POLICY IF EXISTS "Faculty can view student profiles in their sections" ON public.profiles;

-- Recreate using the security definer function (no profiles self-reference)
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
    WHERE fs.faculty_profile_id = get_profile_id_for_user(auth.uid())
    AND sd.profile_id = profiles.id
  )
);
