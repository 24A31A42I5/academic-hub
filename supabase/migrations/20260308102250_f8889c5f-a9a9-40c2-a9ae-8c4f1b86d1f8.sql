
-- Feature statistics for weighted comparison
CREATE TABLE IF NOT EXISTS public.feature_statistics (
  id SERIAL PRIMARY KEY,
  feature_category TEXT NOT NULL,
  feature_value TEXT NOT NULL,
  population_frequency DECIMAL NOT NULL,
  discriminative_weight DECIMAL NOT NULL,
  sample_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(feature_category, feature_value)
);

-- Index for fast lookups during verification
CREATE INDEX idx_feature_stats_lookup ON public.feature_statistics(feature_category, feature_value);

-- Enable RLS but allow service role full access (edge functions use service role)
ALTER TABLE public.feature_statistics ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read (needed by edge functions via service role, but also safe for reads)
CREATE POLICY "Anyone can read feature statistics"
ON public.feature_statistics
FOR SELECT
TO authenticated
USING (true);

-- Only admins can modify
CREATE POLICY "Admins can manage feature statistics"
ON public.feature_statistics
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Populate with research-based baseline data
INSERT INTO public.feature_statistics (feature_category, feature_value, population_frequency, discriminative_weight, sample_count) VALUES
-- Slant distribution
('slant', 'right_lean', 0.60, 0.40, 1000),
('slant', 'upright', 0.25, 0.65, 1000),
('slant', 'left_lean', 0.15, 0.85, 1000),
-- Stroke weight
('stroke_weight', 'medium', 0.70, 0.30, 1000),
('stroke_weight', 'thin', 0.20, 0.75, 1000),
('stroke_weight', 'thick', 0.10, 0.90, 1000),
-- Letter spacing
('letter_spacing', 'normal', 0.65, 0.35, 1000),
('letter_spacing', 'tight', 0.20, 0.75, 1000),
('letter_spacing', 'wide', 0.15, 0.80, 1000),
-- Word spacing
('word_spacing', 'normal', 0.70, 0.30, 1000),
('word_spacing', 'tight', 0.15, 0.85, 1000),
('word_spacing', 'wide', 0.15, 0.85, 1000),
-- Baseline
('baseline', 'straight', 0.60, 0.40, 1000),
('baseline', 'wavy', 0.25, 0.70, 1000),
('baseline', 'variable', 0.15, 0.85, 1000),
-- Height ratio
('height_ratio', 'moderate', 0.70, 0.30, 1000),
('height_ratio', 'tall', 0.20, 0.75, 1000),
('height_ratio', 'short', 0.10, 0.90, 1000),
-- Writing style
('writing_style', 'mixed', 0.65, 0.35, 1000),
('writing_style', 'print', 0.25, 0.70, 1000),
('writing_style', 'cursive', 0.10, 0.90, 1000),
-- Letter formations (shape categories)
('letter_shape', 'rounded', 0.40, 0.50, 1000),
('letter_shape', 'angular', 0.25, 0.70, 1000),
('letter_shape', 'looped', 0.15, 0.80, 1000),
('letter_shape', 'open', 0.30, 0.65, 1000),
('letter_shape', 'closed', 0.35, 0.60, 1000),
('letter_shape', 'simple', 0.50, 0.40, 1000),
('letter_shape', 'mixed', 0.20, 0.75, 1000);

COMMENT ON TABLE public.feature_statistics IS 'Stores population frequency and discriminative weights for handwriting features used in weighted verification scoring';
