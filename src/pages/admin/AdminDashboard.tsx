import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, GraduationCap, BookOpen, AlertTriangle, TrendingUp } from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { logger } from '@/lib/logger';

const navItems = [
  { label: 'Overview', href: '/admin', icon: DashboardIcons.Home },
  { label: 'Students', href: '/admin/students', icon: DashboardIcons.GraduationCap },
  { label: 'Faculty', href: '/admin/faculty', icon: DashboardIcons.Users },
  { label: 'Assignments', href: '/admin/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Fraud Reports', href: '/admin/fraud', icon: DashboardIcons.AlertTriangle },
  { label: 'Section Mapping', href: '/admin/sections', icon: DashboardIcons.Settings },
];

interface Stats {
  totalStudents: number;
  totalFaculty: number;
  totalAssignments: number;
  fraudAlerts: number;
}

const AdminDashboard = () => {
  const { profile, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<Stats>({ totalStudents: 0, totalFaculty: 0, totalAssignments: 0, fraudAlerts: 0 });
  const [recentStudents, setRecentStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch stats
        const [studentsRes, facultyRes, assignmentsRes, fraudRes] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact' }).eq('role', 'student'),
          supabase.from('profiles').select('id', { count: 'exact' }).eq('role', 'faculty'),
          supabase.from('assignments').select('id', { count: 'exact' }),
          supabase.from('submissions').select('id', { count: 'exact' }).in('ai_risk_level', ['high', 'medium']),
        ]);

        setStats({
          totalStudents: studentsRes.count || 0,
          totalFaculty: facultyRes.count || 0,
          totalAssignments: assignmentsRes.count || 0,
          fraudAlerts: fraudRes.count || 0,
        });

        // Fetch recent students
        const { data: students } = await supabase
          .from('profiles')
          .select(`
            id,
            full_name,
            email,
            created_at,
            student_details (
              roll_number,
              year,
              branch,
              section
            )
          `)
          .eq('role', 'student')
          .order('created_at', { ascending: false })
          .limit(5);

        setRecentStudents(students || []);
      } catch (error) {
        logger.error('Error fetching dashboard data', error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.role === 'admin') {
      fetchData();
    }
  }, [profile]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-admin" />
      </div>
    );
  }

  if (!profile || profile.role !== 'admin') {
    return null;
  }

  return (
    <DashboardLayout title="Admin Dashboard" role="admin" navItems={navItems}>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Students"
          value={stats.totalStudents}
          icon={<GraduationCap className="w-6 h-6" />}
          variant="student"
          trend={{ value: 12, label: 'this month', positive: true }}
        />
        <StatsCard
          title="Total Faculty"
          value={stats.totalFaculty}
          icon={<Users className="w-6 h-6" />}
          variant="faculty"
        />
        <StatsCard
          title="Assignments"
          value={stats.totalAssignments}
          icon={<BookOpen className="w-6 h-6" />}
          variant="admin"
        />
        <StatsCard
          title="Fraud Alerts"
          value={stats.fraudAlerts}
          icon={<AlertTriangle className="w-6 h-6" />}
          variant="warning"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Students */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Students</CardTitle>
            <Badge variant="secondary">{stats.totalStudents} total</Badge>
          </CardHeader>
          <CardContent>
            {recentStudents.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No students registered yet</p>
            ) : (
              <div className="space-y-4">
                {recentStudents.map((student) => (
                  <div
                    key={student.id}
                    className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-student flex items-center justify-center">
                      <span className="text-sm font-bold text-student-foreground">
                        {student.full_name?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{student.full_name}</p>
                      <p className="text-sm text-muted-foreground truncate">{student.email}</p>
                    </div>
                    {student.student_details?.[0] && (
                      <div className="flex gap-1">
                        <Badge variant="outline" className="text-xs">
                          Y{student.student_details[0].year}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {student.student_details[0].branch}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {student.student_details[0].section}
                        </Badge>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions / Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">System Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-admin-muted border border-admin/20">
                <div className="flex items-center gap-3 mb-2">
                  <TrendingUp className="w-5 h-5 text-admin" />
                  <span className="font-medium">Active System</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  All systems operational. AI fraud detection is running.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-muted">
                  <p className="text-2xl font-bold text-student">{stats.totalStudents}</p>
                  <p className="text-sm text-muted-foreground">Active Students</p>
                </div>
                <div className="p-4 rounded-lg bg-muted">
                  <p className="text-2xl font-bold text-faculty">{stats.totalFaculty}</p>
                  <p className="text-sm text-muted-foreground">Faculty Members</p>
                </div>
              </div>

              {stats.fraudAlerts > 0 && (
                <div className="p-4 rounded-lg bg-warning-muted border border-warning/20">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-warning" />
                    <div>
                      <span className="font-medium text-warning">
                        {stats.fraudAlerts} submissions require review
                      </span>
                      <p className="text-sm text-muted-foreground">
                        AI detected potential integrity issues
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;
