import { ReactNode, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Shield,
  LogOut,
  Menu,
  X,
  Home,
  Users,
  BookOpen,
  FileText,
  AlertTriangle,
  Settings,
  BarChart3,
  FolderOpen,
  Clock,
  CheckCircle,
  GraduationCap,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface DashboardLayoutProps {
  children: ReactNode;
  title: string;
  role: 'admin' | 'faculty' | 'student';
  navItems: NavItem[];
}

const roleConfig = {
  admin: {
    color: 'bg-admin',
    textColor: 'text-admin',
    mutedBg: 'bg-admin-muted',
    activeNav: 'bg-admin/10 text-admin border-l-4 border-admin',
    gradientFrom: 'from-admin',
  },
  faculty: {
    color: 'bg-faculty',
    textColor: 'text-faculty',
    mutedBg: 'bg-faculty-muted',
    activeNav: 'bg-faculty/10 text-faculty border-l-4 border-faculty',
    gradientFrom: 'from-faculty',
  },
  student: {
    color: 'bg-student',
    textColor: 'text-student',
    mutedBg: 'bg-student-muted',
    activeNav: 'bg-student/10 text-student border-l-4 border-student',
    gradientFrom: 'from-student',
  },
};

export const DashboardLayout = ({ children, title, role, navItems }: DashboardLayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const config = roleConfig[role];

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-card border-r border-border transform transition-transform duration-300 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-border">
            <Link to="/" className="flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', config.color)}>
                <Shield className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <span className="font-bold text-lg">AcademiGuard</span>
                <p className={cn('text-xs capitalize', config.textColor)}>{role} Portal</p>
              </div>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
                    isActive
                      ? config.activeNav
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User Section */}
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted mb-3">
              <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', config.color)}>
                <span className="text-sm font-bold text-primary-foreground">
                  {profile?.full_name?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{profile?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
              </div>
            </div>
            <Button variant="ghost" className="w-full justify-start gap-3" onClick={handleSignOut}>
              <LogOut className="w-5 h-5" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border">
          <div className="flex items-center justify-between px-4 lg:px-8 h-16">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-lg hover:bg-muted"
              >
                <Menu className="w-6 h-6" />
              </button>
              <h1 className="text-xl lg:text-2xl font-bold">{title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className={cn('px-3 py-1.5 rounded-full text-sm font-medium capitalize', config.mutedBg, config.textColor)}>
                {role}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

// Export icon components for use in nav items
export const DashboardIcons = {
  Home,
  Users,
  BookOpen,
  FileText,
  AlertTriangle,
  Settings,
  BarChart3,
  FolderOpen,
  Clock,
  CheckCircle,
  GraduationCap,
};
