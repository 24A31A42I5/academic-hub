CREATE OR REPLACE FUNCTION public.restrict_student_details_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('request.jwt.claims', true)::json->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Students may perform a first-time handwriting submission (i.e. when the
  -- existing sample is empty, such as right after an admin approves a
  -- replacement by clearing it). They may never overwrite an existing one.
  IF NEW.handwriting_url IS DISTINCT FROM OLD.handwriting_url
     AND OLD.handwriting_url IS NOT NULL THEN
    RAISE EXCEPTION 'Students cannot modify protected fields';
  END IF;

  IF NEW.handwriting_image_hash IS DISTINCT FROM OLD.handwriting_image_hash
     AND OLD.handwriting_url IS NOT NULL THEN
    RAISE EXCEPTION 'Students cannot modify protected fields';
  END IF;

  IF NEW.handwriting_submitted_at IS DISTINCT FROM OLD.handwriting_submitted_at
     AND OLD.handwriting_url IS NOT NULL THEN
    RAISE EXCEPTION 'Students cannot modify protected fields';
  END IF;

  -- Feature embedding + extraction timestamp remain service-role only.
  IF NEW.handwriting_feature_embedding IS DISTINCT FROM OLD.handwriting_feature_embedding
    OR NEW.handwriting_features_extracted_at IS DISTINCT FROM OLD.handwriting_features_extracted_at
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