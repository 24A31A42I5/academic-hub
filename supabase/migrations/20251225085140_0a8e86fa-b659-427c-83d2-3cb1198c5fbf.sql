-- Add columns for detailed AI analysis
ALTER TABLE public.submissions 
ADD COLUMN IF NOT EXISTS ai_analysis_details JSONB,
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;