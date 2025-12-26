-- Add storage policies for uploads bucket to allow students to upload files

-- Allow authenticated users to upload files to their own folder
CREATE POLICY "Students can upload their own files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'uploads' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to update their own files  
CREATE POLICY "Students can update their own files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'uploads' AND
  auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'uploads' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to read files in uploads bucket
CREATE POLICY "Anyone can read uploads"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'uploads');

-- Allow authenticated users to delete their own files
CREATE POLICY "Students can delete their own files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'uploads' AND
  auth.uid()::text = (storage.foldername(name))[1]
);