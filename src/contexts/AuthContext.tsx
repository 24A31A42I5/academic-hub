import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

type AppRole = 'admin' | 'faculty' | 'student';

interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone_number?: string | null;
  role: AppRole;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string, role: AppRole, additionalData?: Record<string, unknown>) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        logger.error('Error fetching profile', error);
        return null;
      }
      return data as Profile | null;
    } catch (err) {
      logger.error('Error in fetchProfile', err);
      return null;
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          setTimeout(() => {
            fetchProfile(session.user.id).then(setProfile);
          }, 0);
        } else {
          setProfile(null);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        fetchProfile(session.user.id).then((p) => {
          setProfile(p);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (
    email: string, 
    password: string, 
    fullName: string, 
    role: AppRole,
    additionalData?: Record<string, unknown>
  ) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: { full_name: fullName, role }
        }
      });

      if (authError) return { error: authError };
      if (!authData.user) return { error: new Error('User creation failed') };

      // Create profile
      const phoneNumber = typeof additionalData?.phoneNumber === 'string' ? (additionalData.phoneNumber as string) : null;

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .insert({
          user_id: authData.user.id,
          full_name: fullName,
          email,
          phone_number: phoneNumber,
          role
        })
        .select()
        .single();

      if (profileError) {
        logger.error('Profile creation error', profileError);
        return { error: profileError };
      }

      // Create user role
      const { error: roleError } = await supabase
        .from('user_roles')
        .insert({
          user_id: authData.user.id,
          role
        });

      if (roleError) {
        logger.error('Role creation error', roleError);
        return { error: roleError };
      }

      // Create role-specific details
      if (role === 'student' && additionalData) {
        const { error: studentError } = await supabase
          .from('student_details')
          .insert({
            profile_id: profileData.id,
            roll_number: additionalData.rollNumber as string,
            year: additionalData.year as number,
            branch: additionalData.branch as string,
            section: additionalData.section as string,
            phone_number: (additionalData.phoneNumber as string) || null,
          });

        if (studentError) {
          logger.error('Student details error', studentError);
          return { error: studentError };
        }
      } else if (role === 'faculty' && additionalData) {
        const { error: facultyError } = await supabase
          .from('faculty_details')
          .insert({
            profile_id: profileData.id,
            faculty_id: additionalData.facultyId as string
          });

        if (facultyError) {
          logger.error('Faculty details error', facultyError);
          return { error: facultyError };
        }
      }

      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    // If sign in successful and user is a student, mark as logged in
    if (!error && data.user) {
      setTimeout(async () => {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, role')
          .eq('user_id', data.user.id)
          .single();
        
        if (profileData?.role === 'student') {
          await supabase
            .from('student_details')
            .update({ has_logged_in: true })
            .eq('profile_id', profileData.id);
        }
      }, 0);
    }
    
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) { /* ignore in restricted environments */ }
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
