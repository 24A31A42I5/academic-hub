
-- Fix infinite recursion: faculty policy on profiles references student_details,
-- whose policies reference profiles, causing a loop.
-- Solution: Use SECURITY DEFINER helper functions to break the cycle.

-- Drop the problematic faculty policy
DROP POLICY IF EXISTS "Faculty can view student profiles in their sections" ON public.profiles;

-- Create a SECURITY DEFINER function that checks faculty section membership without triggering RLS
CREATE OR REPLACE FUNCTION public.faculty_can_view_profile(_faculty_user_id uuid, _profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM student_details sd
    JOIN faculty_sections fs ON (fs.year = sd.year AND fs.branch = sd.branch AND fs.section = sd.section)
    JOIN profiles fp ON (fp.id = fs.faculty_profile_id)
    WHERE fp.user_id = _faculty_user_id
      AND sd.profile_id = _profile_id
  )
$$;

-- Recreate the faculty policy using the SECURITY DEFINER function
CREATE POLICY "Faculty can view student profiles in their sections"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.faculty_can_view_profile(auth.uid(), id)
);
