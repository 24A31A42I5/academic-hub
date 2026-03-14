
-- Anti-spoofing: Track submission consistency
CREATE TABLE IF NOT EXISTS public.submission_consistency (
  student_profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  submission_count INTEGER DEFAULT 0,
  avg_variation_score DECIMAL DEFAULT 0,
  perfect_match_count INTEGER DEFAULT 0,
  last_profile_snapshot JSONB,
  spoofing_risk_level TEXT DEFAULT 'none',
  last_checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS for submission_consistency
ALTER TABLE public.submission_consistency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role and admins can manage submission_consistency"
ON public.submission_consistency
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Students can view their own consistency"
ON public.submission_consistency
FOR SELECT
TO authenticated
USING (student_profile_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1));

-- Index for spoofing checks
CREATE INDEX IF NOT EXISTS idx_submission_consistency_risk 
ON public.submission_consistency(spoofing_risk_level, student_profile_id);

-- Add connectivity and line_stability feature stats
INSERT INTO public.feature_statistics (feature_category, feature_value, population_frequency, discriminative_weight, sample_count) VALUES
('connectivity', 'connected', 0.20, 0.75, 0),
('connectivity', 'semi_connected', 0.60, 0.40, 0),
('connectivity', 'disconnected', 0.20, 0.75, 0),
('line_stability', 'straight', 0.55, 0.45, 0),
('line_stability', 'rising', 0.20, 0.75, 0),
('line_stability', 'descending', 0.15, 0.80, 0),
('line_stability', 'erratic', 0.10, 0.90, 0)
ON CONFLICT DO NOTHING;

-- Function to detect AI spoofing patterns
CREATE OR REPLACE FUNCTION public.check_spoofing_risk(
  p_student_profile_id UUID,
  p_current_profile JSONB,
  p_similarity_score INTEGER
) RETURNS TEXT AS $$
DECLARE
  v_consistency RECORD;
  v_variation DECIMAL;
  v_perfect_matches INTEGER;
  v_risk_level TEXT;
BEGIN
  SELECT * INTO v_consistency 
  FROM public.submission_consistency 
  WHERE student_profile_id = p_student_profile_id;
  
  IF v_consistency IS NOT NULL THEN
    v_variation := 100 - p_similarity_score;
    
    IF p_similarity_score >= 98 THEN
      v_perfect_matches := COALESCE(v_consistency.perfect_match_count, 0) + 1;
    ELSE
      v_perfect_matches := 0;
    END IF;
    
    IF v_perfect_matches >= 3 THEN
      v_risk_level := 'high';
    ELSIF v_perfect_matches = 2 THEN
      v_risk_level := 'medium';
    ELSIF COALESCE(v_consistency.avg_variation_score, 0) < 2 AND v_consistency.submission_count > 2 THEN
      v_risk_level := 'medium';
    ELSE
      v_risk_level := 'low';
    END IF;
    
    UPDATE public.submission_consistency SET
      submission_count = COALESCE(submission_count, 0) + 1,
      avg_variation_score = (
        (COALESCE(avg_variation_score, 0) * COALESCE(submission_count, 0) + v_variation) 
        / (COALESCE(submission_count, 0) + 1)
      ),
      perfect_match_count = v_perfect_matches,
      last_profile_snapshot = p_current_profile,
      spoofing_risk_level = v_risk_level,
      last_checked_at = NOW()
    WHERE student_profile_id = p_student_profile_id;
    
  ELSE
    INSERT INTO public.submission_consistency (
      student_profile_id, submission_count, last_profile_snapshot,
      spoofing_risk_level, perfect_match_count, avg_variation_score
    ) VALUES (
      p_student_profile_id, 1, p_current_profile, 'none', 0, 0
    );
    v_risk_level := 'none';
  END IF;
  
  RETURN v_risk_level;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';
