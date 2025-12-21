import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, BookOpen, FileText, Clock, CheckCircle, AlertTriangle, Upload } from 'lucide-react';
import { format, formatDistanceToNow, isPast } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/student', icon: DashboardIcons.Home },
  { label: 'Assignments', href: '/student/assignments', icon: DashboardIcons.BookOpen },
  { label: 'My Submissions', href: '/student/submissions', icon: DashboardIcons.FileText },
  { label: 'Grades', href: '/student/grades', icon: DashboardIcons.CheckCircle },
];

interface Stats {
  totalAssignments: number;
  submitted: number;
  pending: number;
  overdue: number;
}

const StudentDashboard = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ totalAssignments: 0, submitted: 0, pending: 0, overdue: 0 });
  const [studentDetails, setStudentDetails] = useState<any>(null);
  const [upcomingAssignments, setUpcomingAssignments] = useState<any[]>([]);
  const [recentSubmissions, setRecentSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'student')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;

      try {
        // Fetch student details
        const { data: details } = await supabase
          .from('student_details')
          .select('*')
          .eq('profile_id', profile.id)
          .maybeSingle();

        setStudentDetails(details);

        if (!details) {
          setLoading(false);
          return;
        }

        // Fetch assignments for student's section
        const { data: assignments } = await supabase
          .from('assignments')
          .select('*')
          .eq('year', details.year)
          .eq('branch', details.branch)
          .eq('section', details.section)
          .order('deadline', { ascending: true });

        // Fetch student's submissions
        const { data: submissions } = await supabase
          .from('submissions')
          .select('*, assignments(*)')
          .eq('student_profile_id', profile.id)
          .order('submitted_at', { ascending: false });

        const submittedIds = new Set(submissions?.map(s => s.assignment_id) || []);
        const now = new Date();

        let submitted = 0;
        let pending = 0;
        let overdue = 0;

        assignments?.forEach(assignment => {
          if (submittedIds.has(assignment.id)) {
            submitted++;
          } else if (isPast(new Date(assignment.deadline))) {
            overdue++;
          } else {
            pending++;
          }
        });

        setStats({
          totalAssignments: assignments?.length || 0,
          submitted,
          pending,
          overdue,
        });

        // Get upcoming assignments (not submitted, not past deadline)
        const upcoming = assignments
          ?.filter(a => !submittedIds.has(a.id) && !isPast(new Date(a.deadline)))
          .slice(0, 5) || [];
        setUpcomingAssignments(upcoming);

        // Get recent submissions
        setRecentSubmissions(submissions?.slice(0, 5) || []);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.role === 'student') {
      fetchData();
    }
  }, [profile]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-student" />
      </div>
    );
  }

  if (!profile || profile.role !== 'student') {
    return null;
  }

  const completionRate = stats.totalAssignments > 0 
    ? Math.round((stats.submitted / stats.totalAssignments) * 100) 
    : 0;

  return (
    <DashboardLayout title="Student Dashboard" role="student" navItems={navItems}>
      {/* Student Info Banner */}
      {studentDetails && (
        <Card className="mb-6 bg-gradient-to-r from-student-muted to-muted border-student/20">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold mb-1">Welcome, {profile.full_name}!</h2>
                <p className="text-muted-foreground">
                  {studentDetails.branch} • Year {studentDetails.year} • Section {studentDetails.section}
                </p>
                <p className="text-sm text-muted-foreground">Roll: {studentDetails.roll_number}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Completion Rate</p>
                  <p className="text-2xl font-bold text-student">{completionRate}%</p>
                </div>
                <div className="w-24">
                  <Progress value={completionRate} className="h-3" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Assignments"
          value={stats.totalAssignments}
          icon={<BookOpen className="w-6 h-6" />}
          variant="default"
        />
        <StatsCard
          title="Submitted"
          value={stats.submitted}
          icon={<CheckCircle className="w-6 h-6" />}
          variant="student"
        />
        <StatsCard
          title="Pending"
          value={stats.pending}
          icon={<Clock className="w-6 h-6" />}
          variant="faculty"
        />
        <StatsCard
          title="Overdue"
          value={stats.overdue}
          icon={<AlertTriangle className="w-6 h-6" />}
          variant="warning"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upcoming Assignments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Upcoming Deadlines</CardTitle>
            <Link to="/student/assignments">
              <Button variant="ghost" size="sm">View All</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {upcomingAssignments.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="w-12 h-12 text-student mx-auto mb-4" />
                <p className="text-muted-foreground">All caught up! No pending assignments.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingAssignments.map((assignment) => {
                  const deadline = new Date(assignment.deadline);
                  const isUrgent = deadline.getTime() - Date.now() < 24 * 60 * 60 * 1000;

                  return (
                    <div
                      key={assignment.id}
                      className="p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-medium">{assignment.title}</h4>
                        <Badge variant={isUrgent ? 'destructive' : 'outline'}>
                          {formatDistanceToNow(deadline, { addSuffix: true })}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {assignment.description?.slice(0, 100)}
                        {assignment.description?.length > 100 ? '...' : ''}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          <Clock className="w-4 h-4 inline mr-1" />
                          {format(deadline, 'MMM d, yyyy h:mm a')}
                        </span>
                        <Link to={`/student/assignments/${assignment.id}`}>
                          <Button variant="student" size="sm">
                            <Upload className="w-4 h-4 mr-2" />
                            Submit
                          </Button>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Submissions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent Submissions</CardTitle>
            <Link to="/student/submissions">
              <Button variant="ghost" size="sm">View All</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {recentSubmissions.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No submissions yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {recentSubmissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-medium">{submission.assignments?.title}</h4>
                      <Badge
                        variant={
                          submission.status === 'graded'
                            ? 'default'
                            : submission.status === 'reviewed'
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {submission.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>
                        Submitted {format(new Date(submission.submitted_at), 'MMM d, yyyy')}
                      </span>
                      {submission.is_late && (
                        <Badge variant="destructive" className="text-xs">Late</Badge>
                      )}
                      {submission.marks !== null && (
                        <span className="ml-auto font-medium text-student">
                          Score: {submission.marks}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;
