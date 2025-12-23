-- Add semester column to student_details
ALTER TABLE public.student_details
ADD COLUMN semester text NOT NULL DEFAULT 'I' CHECK (semester IN ('I', 'II'));