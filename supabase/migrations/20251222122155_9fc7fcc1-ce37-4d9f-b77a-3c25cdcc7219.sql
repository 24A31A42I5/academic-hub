-- Allow admins to delete profiles
CREATE POLICY "Admins can delete profiles"
ON public.profiles
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Allow admins to update profiles
CREATE POLICY "Admins can update profiles"
ON public.profiles
FOR UPDATE
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Allow admins to delete student details
CREATE POLICY "Admins can delete student details"
ON public.student_details
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Allow admins to delete faculty details
CREATE POLICY "Admins can delete faculty details"
ON public.faculty_details
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Allow admins to update faculty details
CREATE POLICY "Admins can update faculty details"
ON public.faculty_details
FOR UPDATE
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Allow admins to delete user roles
CREATE POLICY "Admins can delete user roles"
ON public.user_roles
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Allow admins to view all faculty sections
CREATE POLICY "Admins can view all faculty sections"
ON public.faculty_sections
FOR SELECT
USING (has_role(auth.uid(), 'admin'));

-- Allow admins to insert faculty sections
CREATE POLICY "Admins can insert faculty sections"
ON public.faculty_sections
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Allow admins to delete faculty sections
CREATE POLICY "Admins can delete faculty sections"
ON public.faculty_sections
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Allow faculty to view student details in their sections
CREATE POLICY "Faculty can view student details in their sections"
ON public.student_details
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM faculty_sections fs
    JOIN profiles p ON p.id = fs.faculty_profile_id
    WHERE p.user_id = auth.uid()
    AND fs.year = student_details.year
    AND fs.branch = student_details.branch
    AND fs.section = student_details.section
  )
);