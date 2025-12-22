-- Allow students to update their own has_logged_in status
CREATE POLICY "Students can update their login status"
ON public.student_details
FOR UPDATE
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

-- Allow admins to update student details
CREATE POLICY "Admins can update student details"
ON public.student_details
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));