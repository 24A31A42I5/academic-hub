-- Add phone_number column to student_details for SMS notifications
ALTER TABLE public.student_details 
ADD COLUMN IF NOT EXISTS phone_number text;

-- Add phone_number column to profiles table as well for general use
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS phone_number text;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_student_details_phone ON public.student_details(phone_number) WHERE phone_number IS NOT NULL;

-- Update RLS policies are already in place, students can update their own details