-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'faculty', 'student');

-- Create profiles table for all users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create student_details table
CREATE TABLE public.student_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  roll_number TEXT NOT NULL UNIQUE,
  year INTEGER NOT NULL CHECK (year >= 1 AND year <= 4),
  branch TEXT NOT NULL,
  section TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create faculty_details table
CREATE TABLE public.faculty_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  faculty_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create user_roles table for role checking (security definer functions)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Create faculty_sections assignment table
CREATE TABLE public.faculty_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  year INTEGER NOT NULL,
  branch TEXT NOT NULL,
  section TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (year, branch, section)
);

-- Create assignments table
CREATE TABLE public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  deadline TIMESTAMP WITH TIME ZONE NOT NULL,
  allowed_formats TEXT[] DEFAULT ARRAY['pdf', 'doc', 'docx', 'image'],
  year INTEGER NOT NULL,
  branch TEXT NOT NULL,
  section TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create submissions table
CREATE TABLE public.submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES public.assignments(id) ON DELETE CASCADE NOT NULL,
  student_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  is_late BOOLEAN DEFAULT false,
  ai_similarity_score DECIMAL(5,2),
  ai_confidence_score DECIMAL(5,2),
  ai_risk_level TEXT DEFAULT 'low',
  ai_flagged_sections TEXT[],
  marks DECIMAL(5,2),
  feedback TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (assignment_id, student_profile_id)
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Function to get current user's role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$$;

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Faculty can view student profiles in their sections" ON public.profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'faculty'));

-- Student details policies
CREATE POLICY "Students can view their own details" ON public.student_details
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = student_details.profile_id AND profiles.user_id = auth.uid())
  );

CREATE POLICY "Students can insert their own details" ON public.student_details
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = student_details.profile_id AND profiles.user_id = auth.uid())
  );

CREATE POLICY "Admins can view all student details" ON public.student_details
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Faculty can view student details" ON public.faculty_details
  FOR SELECT USING (public.has_role(auth.uid(), 'faculty'));

-- Faculty details policies
CREATE POLICY "Faculty can view their own details" ON public.faculty_details
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = faculty_details.profile_id AND profiles.user_id = auth.uid())
  );

CREATE POLICY "Faculty can insert their own details" ON public.faculty_details
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = faculty_details.profile_id AND profiles.user_id = auth.uid())
  );

CREATE POLICY "Admins can view all faculty details" ON public.faculty_details
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- User roles policies
CREATE POLICY "Users can view their own role" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own role" ON public.user_roles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Faculty sections policies
CREATE POLICY "Admins can manage faculty sections" ON public.faculty_sections
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Faculty can view their sections" ON public.faculty_sections
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = faculty_sections.faculty_profile_id AND profiles.user_id = auth.uid())
  );

-- Assignments policies
CREATE POLICY "Faculty can manage their assignments" ON public.assignments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = assignments.faculty_profile_id AND profiles.user_id = auth.uid())
  );

CREATE POLICY "Students can view assignments for their section" ON public.assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.student_details sd
      JOIN public.profiles p ON p.id = sd.profile_id
      WHERE p.user_id = auth.uid()
        AND sd.year = assignments.year
        AND sd.branch = assignments.branch
        AND sd.section = assignments.section
    )
  );

CREATE POLICY "Admins can view all assignments" ON public.assignments
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Submissions policies
CREATE POLICY "Students can manage their own submissions" ON public.submissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = submissions.student_profile_id AND profiles.user_id = auth.uid())
  );

CREATE POLICY "Faculty can view and update submissions for their assignments" ON public.submissions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.assignments a
      JOIN public.profiles p ON p.id = a.faculty_profile_id
      WHERE a.id = submissions.assignment_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all submissions" ON public.submissions
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));