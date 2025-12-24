import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Award, TrendingUp, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/student', icon: DashboardIcons.Home },
  { label: 'Assignments', href: '/student/assignments', icon: DashboardIcons.BookOpen },
  { label: 'My Submissions', href: '/student/submissions', icon: DashboardIcons.FileText },
  { label: 'My Handwriting', href: '/student/handwriting', icon: DashboardIcons.FileText },
  { label: 'Grades', href: '/student/grades', icon: DashboardIcons.CheckCircle },
];

interface GradedSubmission {
  id: string;
  marks: number;
  feedback: string | null;
  is_late: boolean | null;
  submitted_at: string;
  assignment: {
    id: string;
    title: string;
    deadline: string;
  };
}

const StudentGrades = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [gradedSubmissions, setGradedSubmissions] = useState<GradedSubmission[]>([]);
  const [studentDetails, setStudentDetails] = useState<any>(null);
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
        const [detailsRes, submissionsRes] = await Promise.all([
          supabase
            .from('student_details')
            .select('*')
            .eq('profile_id', profile.id)
            .maybeSingle(),
          supabase
            .from('submissions')
            .select(`
              id,
              marks,
              feedback,
              is_late,
              submitted_at,
              assignment:assignments (
                id,
                title,
                deadline
              )
            `)
            .eq('student_profile_id', profile.id)
            .not('marks', 'is', null)
            .order('submitted_at', { ascending: false }),
        ]);

        setStudentDetails(detailsRes.data);
        setGradedSubmissions(submissionsRes.data as unknown as GradedSubmission[] || []);
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

  const averageScore = gradedSubmissions.length > 0
    ? Math.round(gradedSubmissions.reduce((sum, s) => sum + s.marks, 0) / gradedSubmissions.length)
    : 0;

  const highestScore = gradedSubmissions.length > 0
    ? Math.max(...gradedSubmissions.map((s) => s.marks))
    : 0;

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

  return (
    <DashboardLayout title="My Grades" role="student" navItems={navItems}>
      {studentDetails && (
        <div className="mb-4 text-sm text-muted-foreground">
          {studentDetails.branch} • Year {studentDetails.year} • Semester {studentDetails.semester} • Section {studentDetails.section}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-gradient-to-br from-student-muted to-muted border-student/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-student/10 rounded-lg">
                <Award className="w-6 h-6 text-student" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Average Score</p>
                <p className="text-3xl font-bold">{averageScore}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-faculty-muted to-muted border-faculty/20">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-faculty/10 rounded-lg">
                <TrendingUp className="w-6 h-6 text-faculty" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Highest Score</p>
                <p className="text-3xl font-bold">{highestScore}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-muted to-background border-border">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-lg">
                <Award className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Graded Assignments</p>
                <p className="text-3xl font-bold">{gradedSubmissions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grade List */}
      {gradedSubmissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Award className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No graded assignments yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {gradedSubmissions.map((submission) => (
            <Card key={submission.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">{submission.assignment?.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      Submitted {format(new Date(submission.submitted_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-student">{submission.marks}%</p>
                    {submission.is_late && (
                      <Badge variant="destructive" className="mt-1">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Late
                      </Badge>
                    )}
                  </div>
                </div>
                <Progress value={submission.marks} className="h-2 mb-3" />
                {submission.feedback && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium mb-1">Feedback:</p>
                    <p className="text-sm text-muted-foreground">{submission.feedback}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
};

export default StudentGrades;
