import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import type { Database } from '@/integrations/supabase/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, BookOpen, Clock, Upload, CheckCircle, Search, AlertTriangle } from 'lucide-react';
import { format, formatDistanceToNow, isPast } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/student', icon: DashboardIcons.Home },
  { label: 'Assignments', href: '/student/assignments', icon: DashboardIcons.BookOpen },
  { label: 'My Submissions', href: '/student/submissions', icon: DashboardIcons.FileText },
  { label: 'My Handwriting', href: '/student/handwriting', icon: DashboardIcons.FileText },
  { label: 'Grades', href: '/student/grades', icon: DashboardIcons.CheckCircle },
];

interface Assignment {
  id: string;
  title: string;
  description: string | null;
  year: number;
  branch: string;
  section: string;
  deadline: string;
  allowed_formats: string[] | null;
  created_at: string;
}

interface Submission {
  assignment_id: string;
}

const StudentAssignments = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [studentDetails, setStudentDetails] = useState<Database['public']['Tables']['student_details']['Row'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'student')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;

      try {
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

        const [assignmentsRes, submissionsRes] = await Promise.all([
          supabase
            .from('assignments')
            .select('*')
            .eq('year', details.year)
            .eq('branch', details.branch)
            .eq('section', details.section)
            .order('deadline', { ascending: true }),
          supabase
            .from('submissions')
            .select('assignment_id')
            .eq('student_profile_id', profile.id),
        ]);

        setAssignments(assignmentsRes.data || []);
        setSubmissions(submissionsRes.data || []);
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

  const submittedIds = new Set(submissions.map((s) => s.assignment_id));

  const filteredAssignments = assignments.filter((assignment) => {
    const matchesSearch = assignment.title.toLowerCase().includes(searchTerm.toLowerCase());
    const isSubmitted = submittedIds.has(assignment.id);
    const isOverdue = isPast(new Date(assignment.deadline)) && !isSubmitted;
    const isPending = !isPast(new Date(assignment.deadline)) && !isSubmitted;

    if (filterStatus === 'submitted') return matchesSearch && isSubmitted;
    if (filterStatus === 'pending') return matchesSearch && isPending;
    if (filterStatus === 'overdue') return matchesSearch && isOverdue;
    return matchesSearch;
  });

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
    <DashboardLayout title="Assignments" role="student" navItems={navItems}>
      {studentDetails && (
        <div className="mb-4 text-sm text-muted-foreground">
          {studentDetails.branch} • Year {studentDetails.year} • Semester {studentDetails.semester} • Section {studentDetails.section}
        </div>
      )}

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search assignments..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {filteredAssignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No assignments found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredAssignments.map((assignment) => {
            const isSubmitted = submittedIds.has(assignment.id);
            const deadline = new Date(assignment.deadline);
            const isOverdue = isPast(deadline) && !isSubmitted;
            const isUrgent = !isSubmitted && !isOverdue && deadline.getTime() - Date.now() < 24 * 60 * 60 * 1000;

            return (
              <Card key={assignment.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold">{assignment.title}</h3>
                        {isSubmitted ? (
                          <Badge className="bg-student text-student-foreground">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Submitted
                          </Badge>
                        ) : isOverdue ? (
                          <Badge variant="destructive">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Overdue
                          </Badge>
                        ) : isUrgent ? (
                          <Badge variant="destructive">
                            <Clock className="w-3 h-3 mr-1" />
                            Due Soon
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            <Clock className="w-3 h-3 mr-1" />
                            Pending
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {assignment.description || 'No description provided'}
                      </p>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          Due: {format(deadline, 'MMM d, yyyy h:mm a')}
                          <span className="text-xs ml-1">
                            ({formatDistanceToNow(deadline, { addSuffix: true })})
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!isSubmitted && !isOverdue && (
                        <Link to={`/student/assignments/${assignment.id}`}>
                          <Button variant="student" size="sm">
                            <Upload className="w-4 h-4 mr-1" />
                            Submit
                          </Button>
                        </Link>
                      )}
                      {isSubmitted && (
                        <Link to="/student/submissions">
                          <Button variant="outline" size="sm">
                            View Submission
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardLayout>
  );
};

export default StudentAssignments;
