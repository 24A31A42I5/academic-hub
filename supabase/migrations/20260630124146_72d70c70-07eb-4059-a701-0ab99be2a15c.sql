-- Revoke broad EXECUTE on all SECURITY DEFINER functions in public schema
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_profile_id_for_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.faculty_can_view_profile(uuid, uuid) FROM PUBLIC, anon;

-- These helpers are referenced by RLS policies evaluated for signed-in users, so authenticated must retain EXECUTE.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_id_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.faculty_can_view_profile(uuid, uuid) TO authenticated;

-- These are trigger/service functions; they must never be callable from the API.
REVOKE EXECUTE ON FUNCTION public.check_spoofing_risk(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restrict_student_details_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restrict_submission_update() FROM PUBLIC, anon, authenticated;