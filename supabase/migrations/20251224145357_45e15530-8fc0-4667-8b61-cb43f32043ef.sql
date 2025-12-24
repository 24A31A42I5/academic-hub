-- Add handwriting_url column to student_details table
ALTER TABLE public.student_details 
ADD COLUMN handwriting_url text NULL,
ADD COLUMN handwriting_submitted_at timestamp with time zone NULL;

-- Create storage bucket for handwriting samples
INSERT INTO storage.buckets (id, name, public) 
VALUES ('handwriting-samples', 'handwriting-samples', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for handwriting samples
-- Students can upload their own handwriting (only once - handled in application)
CREATE POLICY "Students can upload their own handwriting"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'handwriting-samples' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Students can view their own handwriting
CREATE POLICY "Students can view their own handwriting"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'handwriting-samples' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Faculty can view handwriting of students in their sections
CREATE POLICY "Faculty can view student handwriting"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'handwriting-samples'
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'faculty'
  )
);

-- Admins have full access to handwriting samples
CREATE POLICY "Admins can manage all handwriting samples"
ON storage.objects
FOR ALL
USING (
  bucket_id = 'handwriting-samples'
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
);

-- Only admins can delete handwriting samples
CREATE POLICY "Only admins can delete handwriting"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'handwriting-samples'
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
);