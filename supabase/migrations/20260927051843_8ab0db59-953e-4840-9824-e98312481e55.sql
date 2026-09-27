CREATE TABLE public.handwriting_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  image_hash text,
  quality_metrics jsonb,
  extracted_features jsonb,
  extraction_confidence numeric,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  schema_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_profile_id, image_hash)
);
CREATE INDEX idx_handwriting_samples_student ON public.handwriting_samples(student_profile_id);

GRANT SELECT, DELETE ON public.handwriting_samples TO authenticated;
GRANT ALL ON public.handwriting_samples TO service_role;

ALTER TABLE public.handwriting_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students view own samples" ON public.handwriting_samples
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = handwriting_samples.student_profile_id AND p.user_id = auth.uid()));

CREATE POLICY "Students delete own non-accepted samples" ON public.handwriting_samples
FOR DELETE TO authenticated USING (status <> 'accepted' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = handwriting_samples.student_profile_id AND p.user_id = auth.uid()));

CREATE POLICY "Faculty view samples in their sections" ON public.handwriting_samples
FOR SELECT TO authenticated USING (public.faculty_can_view_profile(auth.uid(), student_profile_id));

CREATE POLICY "Admins manage samples" ON public.handwriting_samples
FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER update_handwriting_samples_updated_at BEFORE UPDATE ON public.handwriting_samples
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.student_details
  ADD COLUMN IF NOT EXISTS handwriting_sample_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS handwriting_profile_version text;

CREATE OR REPLACE FUNCTION public.restrict_student_details_update()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.handwriting_url IS DISTINCT FROM OLD.handwriting_url AND OLD.handwriting_url IS NOT NULL THEN
    RAISE EXCEPTION 'Students cannot modify protected fields';
  END IF;
  IF NEW.handwriting_image_hash IS DISTINCT FROM OLD.handwriting_image_hash AND OLD.handwriting_url IS NOT NULL THEN
    RAISE EXCEPTION 'Students cannot modify protected fields';
  END IF;
  IF NEW.handwriting_submitted_at IS DISTINCT FROM OLD.handwriting_submitted_at AND OLD.handwriting_url IS NOT NULL THEN
    RAISE EXCEPTION 'Students cannot modify protected fields';
  END IF;
  IF NEW.handwriting_feature_embedding IS DISTINCT FROM OLD.handwriting_feature_embedding
    OR NEW.handwriting_features_extracted_at IS DISTINCT FROM OLD.handwriting_features_extracted_at
    OR NEW.handwriting_sample_count IS DISTINCT FROM OLD.handwriting_sample_count
    OR NEW.handwriting_profile_version IS DISTINCT FROM OLD.handwriting_profile_version
    OR NEW.roll_number IS DISTINCT FROM OLD.roll_number
    OR NEW.branch IS DISTINCT FROM OLD.branch
    OR NEW.section IS DISTINCT FROM OLD.section
    OR NEW.year IS DISTINCT FROM OLD.year
    OR NEW.semester IS DISTINCT FROM OLD.semester
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
  THEN
    RAISE EXCEPTION 'Students cannot modify protected fields';
  END IF;
  RETURN NEW;
END;
$function$;

-- Enrollment images are write-once: students may no longer overwrite stored files.
DROP POLICY IF EXISTS "Students can update their own handwriting" ON storage.objects;