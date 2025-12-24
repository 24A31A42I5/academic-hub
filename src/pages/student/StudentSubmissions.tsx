import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, FileText, ExternalLink, Clock, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/student', icon: DashboardIcons.Home },
  { label: 'Assignments', href: '/student/assignments', icon: DashboardIcons.BookOpen },
  { label: 'My Submissions', href: '/student/submissions', icon: DashboardIcons.FileText },
  { label: 'My Handwriting', href: '/student/handwriting', icon: DashboardIcons.FileText },
  { label: 'Grades', href: '/student/grades', icon: DashboardIcons.CheckCircle },
];

interface Submission {
  id: string;
  file_url: string;
  file_type: string;
  status: string | null;
  marks: number | null;
  feedback: string | null;
  is_late: boolean | null;
  submitted_at: string;
  assignment: {
    id: string;
    title: string;
    year: number;
    branch: string;
    section: string;
    deadline: string;
  };
}

const StudentSubmissions = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
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
              file_url,
              file_type,
              status,
              marks,
              feedback,
              is_late,
              submitted_at,
              assignment:assignments (
                id,
                title,
                year,
                branch,
                section,
                deadline
              )
            `)
            .eq('student_profile_id', profile.id)
            .order('submitted_at', { ascending: false }),
        ]);

        setStudentDetails(detailsRes.data);
        setSubmissions(submissionsRes.data as unknown as Submission[] || []);
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

  return (
    <DashboardLayout title="My Submissions" role="student" navItems={navItems}>
      {studentDetails && (
        <div className="mb-4 text-sm text-muted-foreground">
          {studentDetails.branch} • Year {studentDetails.year} • Semester {studentDetails.semester} • Section {studentDetails.section}
        </div>
      )}

      {submissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No submissions yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead>Feedback</TableHead>
                  <TableHead className="text-right">File</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{submission.assignment?.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Due: {format(new Date(submission.assignment?.deadline), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          {format(new Date(submission.submitted_at), 'MMM d, h:mm a')}
                        </span>
                        {submission.is_late && (
                          <Badge variant="destructive" className="text-xs">Late</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={submission.status === 'graded' ? 'default' : 'outline'}>
                        {submission.status === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                        {submission.status === 'graded' && <CheckCircle className="w-3 h-3 mr-1" />}
                        {submission.status || 'Pending'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {submission.marks !== null ? (
                        <span className="font-medium text-student">{submission.marks}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm max-w-[200px] truncate">
                        {submission.feedback || '-'}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <a href={submission.file_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
};

export default StudentSubmissions;
