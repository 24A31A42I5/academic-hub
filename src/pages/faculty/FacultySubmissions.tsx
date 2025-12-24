import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, FileText, AlertTriangle, Clock, CheckCircle, ExternalLink, Search } from 'lucide-react';
import { format } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/faculty', icon: DashboardIcons.Home },
  { label: 'My Sections', href: '/faculty/sections', icon: DashboardIcons.FolderOpen },
  { label: 'Assignments', href: '/faculty/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Submissions', href: '/faculty/submissions', icon: DashboardIcons.FileText },
  { label: 'AI Reviews', href: '/faculty/reviews', icon: DashboardIcons.AlertTriangle },
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
  ai_risk_level: string | null;
  ai_similarity_score: number | null;
  ai_confidence_score: number | null;
  student_profile: {
    id: string;
    full_name: string;
    email: string;
  };
  assignment: {
    id: string;
    title: string;
    year: number;
    branch: string;
    section: string;
  };
}

interface Assignment {
  id: string;
  title: string;
}

const FacultySubmissions = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAssignment, setFilterAssignment] = useState<string>(searchParams.get('assignment') || 'all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  const [gradeSubmission, setGradeSubmission] = useState<Submission | null>(null);
  const [gradeForm, setGradeForm] = useState({ marks: '', feedback: '', status: 'graded' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'faculty')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  const fetchData = async () => {
    if (!profile) return;

    try {
      const [submissionsRes, assignmentsRes] = await Promise.all([
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
            ai_risk_level,
            ai_similarity_score,
            ai_confidence_score,
            student_profile:profiles!submissions_student_profile_id_fkey (
              id,
              full_name,
              email
            ),
            assignment:assignments!inner (
              id,
              title,
              year,
              branch,
              section,
              faculty_profile_id
            )
          `)
          .eq('assignment.faculty_profile_id', profile.id)
          .order('submitted_at', { ascending: false }),
        supabase
          .from('assignments')
          .select('id, title')
          .eq('faculty_profile_id', profile.id),
      ]);

      if (submissionsRes.error) throw submissionsRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      setSubmissions(submissionsRes.data as unknown as Submission[] || []);
      setAssignments(assignmentsRes.data || []);
    } catch (error) {
      console.error('Error fetching submissions:', error);
      toast.error('Failed to load submissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.role === 'faculty') {
      fetchData();
    }
  }, [profile]);

  const handleGrade = async () => {
    if (!gradeSubmission) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('submissions')
        .update({
          marks: gradeForm.marks ? parseFloat(gradeForm.marks) : null,
          feedback: gradeForm.feedback || null,
          status: gradeForm.status,
        })
        .eq('id', gradeSubmission.id);

      if (error) throw error;

      toast.success('Submission graded successfully');
      setGradeSubmission(null);
      setGradeForm({ marks: '', feedback: '', status: 'graded' });
      fetchData();
    } catch (error) {
      console.error('Error grading submission:', error);
      toast.error('Failed to grade submission');
    } finally {
      setSaving(false);
    }
  };

  const openGradeDialog = (submission: Submission) => {
    setGradeSubmission(submission);
    setGradeForm({
      marks: submission.marks?.toString() || '',
      feedback: submission.feedback || '',
      status: submission.status || 'graded',
    });
  };

  const filteredSubmissions = submissions.filter((sub) => {
    const matchesSearch =
      sub.student_profile?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.student_profile?.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAssignment = filterAssignment === 'all' || sub.assignment?.id === filterAssignment;
    const matchesStatus = filterStatus === 'all' || sub.status === filterStatus;

    return matchesSearch && matchesAssignment && matchesStatus;
  });

  const getRiskBadge = (level: string | null) => {
    switch (level) {
      case 'high':
        return <Badge variant="destructive">High Risk</Badge>;
      case 'medium':
        return <Badge className="bg-warning text-warning-foreground">Medium Risk</Badge>;
      case 'low':
        return <Badge variant="secondary">Low Risk</Badge>;
      default:
        return <Badge variant="outline">Not Analyzed</Badge>;
    }
  };

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
    <DashboardLayout title="Submissions" role="faculty" navItems={navItems}>
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by student name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={filterAssignment} onValueChange={setFilterAssignment}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by assignment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignments</SelectItem>
                {assignments.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="graded">Graded</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {filteredSubmissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No submissions found</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>AI Risk</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSubmissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{submission.student_profile?.full_name}</p>
                        <p className="text-sm text-muted-foreground">{submission.student_profile?.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{submission.assignment?.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Year {submission.assignment?.year} - Sem {(submission.assignment as any)?.semester || 'I'} - {submission.assignment?.branch} - {submission.assignment?.section}
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
                    <TableCell>{getRiskBadge(submission.ai_risk_level)}</TableCell>
                    <TableCell>
                      {submission.marks !== null ? (
                        <span className="font-medium">{submission.marks}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" asChild>
                          <a href={submission.file_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openGradeDialog(submission)}>
                          Grade
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Grade Dialog */}
      <Dialog open={!!gradeSubmission} onOpenChange={() => setGradeSubmission(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grade Submission</DialogTitle>
          </DialogHeader>
          {gradeSubmission && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="font-medium">{gradeSubmission.student_profile?.full_name}</p>
                <p className="text-sm text-muted-foreground">{gradeSubmission.assignment?.title}</p>
              </div>
              <div>
                <Label>Marks</Label>
                <Input
                  type="number"
                  value={gradeForm.marks}
                  onChange={(e) => setGradeForm({ ...gradeForm, marks: e.target.value })}
                  placeholder="Enter marks"
                />
              </div>
              <div>
                <Label>Feedback</Label>
                <Textarea
                  value={gradeForm.feedback}
                  onChange={(e) => setGradeForm({ ...gradeForm, feedback: e.target.value })}
                  placeholder="Provide feedback to the student"
                  rows={4}
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={gradeForm.status} onValueChange={(v) => setGradeForm({ ...gradeForm, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="graded">Graded</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGradeSubmission(null)}>
              Cancel
            </Button>
            <Button variant="faculty" onClick={handleGrade} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save Grade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default FacultySubmissions;
