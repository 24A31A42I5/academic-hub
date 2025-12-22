import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

type AppRole = 'admin' | 'faculty' | 'student';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: AppRole[];
  redirectTo?: string;
}

/**
 * A wrapper component that protects routes based on user roles.
 * Renders nothing until authentication is verified, preventing UI exposure.
 */
export const ProtectedRoute = ({ 
  children, 
  allowedRoles, 
  redirectTo = '/auth' 
}: ProtectedRouteProps) => {
  const { profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (!profile) {
        navigate(redirectTo);
      } else if (!allowedRoles.includes(profile.role)) {
        // Redirect to appropriate dashboard based on role
        switch (profile.role) {
          case 'admin':
            navigate('/admin');
            break;
          case 'faculty':
            navigate('/faculty');
            break;
          case 'student':
            navigate('/student');
            break;
          default:
            navigate(redirectTo);
        }
      }
    }
  }, [profile, loading, navigate, allowedRoles, redirectTo]);

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Don't render anything if not authorized (prevents UI exposure)
  if (!profile || !allowedRoles.includes(profile.role)) {
    return null;
  }

  // User is authorized, render children
  return <>{children}</>;
};
