-- Add file_urls column for multi-page image submissions
ALTER TABLE public.submissions 
ADD COLUMN IF NOT EXISTS file_urls TEXT[] DEFAULT NULL;

-- Add page_verification_results column for per-page AI results
ALTER TABLE public.submissions 
ADD COLUMN IF NOT EXISTS page_verification_results JSONB DEFAULT NULL;

-- Update default allowed_formats to image-only for new assignments
ALTER TABLE public.assignments 
ALTER COLUMN allowed_formats SET DEFAULT ARRAY['image']::TEXT[];