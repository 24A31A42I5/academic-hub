-- Add semester column to faculty_sections if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'faculty_sections' AND column_name = 'semester'
  ) THEN
    ALTER TABLE public.faculty_sections ADD COLUMN semester text NOT NULL DEFAULT 'I';
  END IF;
END $$;