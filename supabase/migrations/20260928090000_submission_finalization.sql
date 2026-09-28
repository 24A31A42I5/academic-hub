ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by_student boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.submissions.finalized_at IS 'Set only by the finalize-submission edge function after AI consistency review.';

-- Preserve the legacy enrollment count so existing students are shown as
-- incomplete rather than appearing to have no handwriting history at all.
UPDATE public.student_details
SET handwriting_sample_count = 1
WHERE handwriting_sample_count = 0
  AND handwriting_url IS NOT NULL
  AND handwriting_feature_embedding IS NOT NULL;