-- Add feature_embedding and image_hash columns to student_details for robust handwriting verification
ALTER TABLE public.student_details
ADD COLUMN IF NOT EXISTS handwriting_image_hash TEXT,
ADD COLUMN IF NOT EXISTS handwriting_feature_embedding JSONB,
ADD COLUMN IF NOT EXISTS handwriting_features_extracted_at TIMESTAMP WITH TIME ZONE;

-- Create unique index on image_hash to prevent same image being uploaded by different students
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_details_handwriting_hash 
ON public.student_details(handwriting_image_hash) 
WHERE handwriting_image_hash IS NOT NULL;

-- Add index for efficient feature embedding lookups
CREATE INDEX IF NOT EXISTS idx_student_details_feature_embedding 
ON public.student_details USING GIN(handwriting_feature_embedding);

-- Add comment for documentation
COMMENT ON COLUMN public.student_details.handwriting_image_hash IS 'SHA-256 hash of the handwriting sample image to prevent re-uploads';
COMMENT ON COLUMN public.student_details.handwriting_feature_embedding IS 'JSONB containing extracted handwriting features vector for comparison';
COMMENT ON COLUMN public.student_details.handwriting_features_extracted_at IS 'Timestamp when features were last extracted';