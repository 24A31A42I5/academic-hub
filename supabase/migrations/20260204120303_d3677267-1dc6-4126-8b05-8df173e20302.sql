-- 1) Fix handwriting re-upload (Storage upsert requires UPDATE policy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Students can update their own handwriting'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Students can update their own handwriting"
      ON storage.objects
      FOR UPDATE
      TO public
      USING (
        bucket_id = 'handwriting-samples'
        AND auth.uid()::text = (storage.foldername(name))[1]
      )
      WITH CHECK (
        bucket_id = 'handwriting-samples'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
    $pol$;
  END IF;
END $$;

-- 2) Enforce marks max=5 (normalize existing data first)
UPDATE public.submissions
SET marks = 5
WHERE marks > 5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'submissions_marks_max_5'
  ) THEN
    ALTER TABLE public.submissions
      ADD CONSTRAINT submissions_marks_max_5
      CHECK (marks IS NULL OR (marks >= 0 AND marks <= 5));
  END IF;
END $$;