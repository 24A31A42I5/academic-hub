-- Add has_logged_in field to student_details to track first login
ALTER TABLE public.student_details 
ADD COLUMN has_logged_in boolean DEFAULT false;

-- Create storage bucket for file uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', false);

-- Storage policies for admin uploads
CREATE POLICY "Admins can upload files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'uploads' AND
  public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Admins can view uploaded files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'uploads' AND
  public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Admins can delete uploaded files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'uploads' AND
  public.has_role(auth.uid(), 'admin'::app_role)
);