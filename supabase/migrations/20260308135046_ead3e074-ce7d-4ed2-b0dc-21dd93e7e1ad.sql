
-- Add new feature categories for v7.0 enhanced biometric features
-- pen_pressure
INSERT INTO public.feature_statistics (feature_category, feature_value, population_frequency, discriminative_weight, sample_count)
VALUES
  ('pen_pressure', 'light', 0.25, 0.55, 0),
  ('pen_pressure', 'medium', 0.55, 0.30, 0),
  ('pen_pressure', 'heavy', 0.20, 0.60, 0),
  ('line_quality', 'smooth', 0.40, 0.35, 0),
  ('line_quality', 'shaky', 0.15, 0.70, 0),
  ('line_quality', 'variable', 0.45, 0.40, 0),
  ('size_consistency', 'uniform', 0.50, 0.30, 0),
  ('size_consistency', 'variable', 0.35, 0.45, 0),
  ('size_consistency', 'decreasing', 0.15, 0.70, 0),
  ('t_cross_position', 'low', 0.15, 0.65, 0),
  ('t_cross_position', 'middle', 0.60, 0.30, 0),
  ('t_cross_position', 'high', 0.25, 0.50, 0),
  ('i_dot_style', 'round', 0.35, 0.40, 0),
  ('i_dot_style', 'dash', 0.25, 0.50, 0),
  ('i_dot_style', 'absent', 0.10, 0.75, 0),
  ('i_dot_style', 'circle', 0.05, 0.85, 0)
ON CONFLICT DO NOTHING;
