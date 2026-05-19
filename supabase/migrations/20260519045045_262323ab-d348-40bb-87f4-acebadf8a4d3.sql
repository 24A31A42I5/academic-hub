
-- =========================================
-- Performance: Missing indexes on hot paths
-- =========================================

-- Assignments: filtered by faculty (faculty RLS) and by (year,branch,section) (student RLS)
CREATE INDEX IF NOT EXISTS idx_assignments_faculty_profile_id
  ON public.assignments (faculty_profile_id);
CREATE INDEX IF NOT EXISTS idx_assignments_year_branch_section
  ON public.assignments (year, branch, section);
CREATE INDEX IF NOT EXISTS idx_assignments_deadline
  ON public.assignments (deadline);

-- Submissions: looked up by student and by assignment (faculty grading)
CREATE INDEX IF NOT EXISTS idx_submissions_student_profile_id
  ON public.submissions (student_profile_id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id
  ON public.submissions (assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON public.submissions (status);
CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at
  ON public.submissions (submitted_at DESC);

-- Faculty sections: per-faculty lookup
CREATE INDEX IF NOT EXISTS idx_faculty_sections_faculty_profile_id
  ON public.faculty_sections (faculty_profile_id);

-- Student details: per-section lookup (faculty viewing students)
CREATE INDEX IF NOT EXISTS idx_student_details_year_branch_section
  ON public.student_details (year, branch, section);

-- Profiles: role filter sometimes used
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles (role);

-- =========================================
-- Security: revoke EXECUTE from public/anon
-- on internal trigger & service-only funcs
-- (RLS-helper functions remain callable, as
--  RLS policies invoke them as the calling user.)
-- =========================================

REVOKE EXECUTE ON FUNCTION public.handle_new_user_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restrict_submission_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restrict_student_details_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_spoofing_risk(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
