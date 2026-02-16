
-- Fix 1: Create trigger to auto-insert user_roles on profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  SELECT p.user_id, p.role
  FROM public.profiles p
  WHERE p.id = NEW.id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- Fire after a profile is inserted (profiles table, not auth.users)
CREATE TRIGGER on_profile_created_assign_role
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();
