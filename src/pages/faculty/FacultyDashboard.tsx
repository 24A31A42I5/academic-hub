import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, BookOpen, FileText, AlertTriangle, CheckCircle, Plus, Clock } from 'lucide-react';
import { format } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/faculty', icon: DashboardIcons.Home },
  { label: 'My Sections', href: '/faculty/sections', icon: DashboardIcons.FolderOpen },
  { label: 'Assignments', href: '/faculty/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Submissions', href: '/faculty/submissions', icon: DashboardIcons.FileText },
  { label: 'AI Reviews', href: '/faculty/reviews', icon: DashboardIcons.AlertTriangle },
];

interface Stats {
  totalAssignments: number;
  pendingReviews: number;
  flaggedSubmissions: number;
  sectionsAssigned: number;
}

const FacultyDashboard = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ 
    totalAssignments: 0, 
    pendingReviews: 0, 
    flaggedSubmissions: 0, 
    sectionsAssigned: 0 
  });
  const [recentAssignments, setRecentAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'faculty')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;

      try {
        // Fetch assignments
        const { data: assignments, count: assignmentsCount } = await supabase
          .from('assignments')
          .select('*, submissions(id, status, ai_risk_level)', { count: 'exact' })
          .eq('faculty_profile_id', profile.id)
          .order('created_at', { ascending: false });

        // Fetch sections
        const { count: sectionsCount } = await supabase
          .from('faculty_sections')
          .select('id', { count: 'exact' })
          .eq('faculty_profile_id', profile.id);

        // Calculate stats
        let pendingReviews = 0;
        let flaggedSubmissions = 0;

        assignments?.forEach(assignment => {
          assignment.submissions?.forEach((sub: any) => {
            if (sub.status === 'pending') pendingReviews++;
            if (['high', 'medium'].includes(sub.ai_risk_level)) flaggedSubmissions++;
          });
        });

        setStats({
          totalAssignments: assignmentsCount || 0,
          pendingReviews,
          flaggedSubmissions,
          sectionsAssigned: sectionsCount || 0,
        });

        setRecentAssignments(assignments?.slice(0, 5) || []);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.role === 'faculty') {
      fetchData();
    }
  }, [profile]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-faculty" />
      </div>
    );
  }

  if (!profile || profile.role !== 'faculty') {
    return null;
  }

  return (
    <DashboardLayout title="Faculty Dashboard" role="faculty" navItems={navItems}>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="My Assignments"
          value={stats.totalAssignments}
          icon={<BookOpen className="w-6 h-6" />}
          variant="faculty"
        />
        <StatsCard
          title="Pending Reviews"
          value={stats.pendingReviews}
          icon={<Clock className="w-6 h-6" />}
          variant="default"
        />
        <StatsCard
          title="Flagged Submissions"
          value={stats.flaggedSubmissions}
          icon={<AlertTriangle className="w-6 h-6" />}
          variant="warning"
        />
        <StatsCard
          title="Sections Assigned"
          value={stats.sectionsAssigned}
          icon={<CheckCircle className="w-6 h-6" />}
          variant="student"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Assignments */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Assignments</CardTitle>
            <Link to="/faculty/assignments/new">
              <Button variant="faculty" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Create New
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentAssignments.length === 0 ? (
              <div className="text-center py-12">
                <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">No assignments created yet</p>
                <Link to="/faculty/assignments/new">
                  <Button variant="faculty">Create Your First Assignment</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {recentAssignments.map((assignment) => {
                  const submissionCount = assignment.submissions?.length || 0;
                  const flaggedCount = assignment.submissions?.filter(
                    (s: any) => ['high', 'medium'].includes(s.ai_risk_level)
                  ).length || 0;

                  return (
                    <div
                      key={assignment.id}
                      className="p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="font-medium">{assignment.title}</h4>
                          <p className="text-sm text-muted-foreground">
                            {assignment.year}Y - {assignment.branch} - Section {assignment.section}
                          </p>
                        </div>
                        <Badge variant={new Date(assignment.deadline) < new Date() ? 'destructive' : 'outline'}>
                          {new Date(assignment.deadline) < new Date() ? 'Closed' : 'Active'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <FileText className="w-4 h-4" />
                          {submissionCount} submissions
                        </span>
                        {flaggedCount > 0 && (
                          <span className="flex items-center gap-1 text-warning">
                            <AlertTriangle className="w-4 h-4" />
                            {flaggedCount} flagged
                          </span>
                        )}
                        <span className="text-muted-foreground ml-auto">
                          Due: {format(new Date(assignment.deadline), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link to="/faculty/assignments/new" className="block">
              <Button variant="outline" className="w-full justify-start gap-3">
                <Plus className="w-5 h-5 text-faculty" />
                Create Assignment
              </Button>
            </Link>
            <Link to="/faculty/submissions" className="block">
              <Button variant="outline" className="w-full justify-start gap-3">
                <FileText className="w-5 h-5 text-faculty" />
                View Submissions
              </Button>
            </Link>
            <Link to="/faculty/reviews" className="block">
              <Button variant="outline" className="w-full justify-start gap-3">
                <AlertTriangle className="w-5 h-5 text-warning" />
                Review Flagged ({stats.flaggedSubmissions})
              </Button>
            </Link>
            <Link to="/faculty/sections" className="block">
              <Button variant="outline" className="w-full justify-start gap-3">
                <CheckCircle className="w-5 h-5 text-student" />
                My Sections
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default FacultyDashboard;
