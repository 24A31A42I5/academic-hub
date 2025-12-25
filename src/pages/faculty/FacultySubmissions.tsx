import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, FileText, AlertTriangle, Clock, CheckCircle, ExternalLink, Search, Users } from 'lucide-react';
import { format } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/faculty', icon: DashboardIcons.Home },
  { label: 'My Sections', href: '/faculty/sections', icon: DashboardIcons.FolderOpen },
  { label: 'Assignments', href: '/faculty/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Submissions', href: '/faculty/submissions', icon: DashboardIcons.FileText },
  { label: 'AI Reviews', href: '/faculty/reviews', icon: DashboardIcons.AlertTriangle },
];

const BRANCHES = ['CSE', 'AIML', 'AI', 'DS', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL'];
const YEARS = [1, 2, 3, 4];
const SECTIONS = ['A', 'B', 'C'];
const SEMESTERS = ['I', 'II'];

interface StudentDetails {
  roll_number: string;
  year: number;
  branch: string;
  section: string;
  semester: string;
}

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
    student_details?: StudentDetails[];
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
  const [allStudents, setAllStudents] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAssignment, setFilterAssignment] = useState<string>(searchParams.get('assignment') || 'all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterSubmitted, setFilterSubmitted] = useState<string>('all');
  
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
      const [submissionsRes, assignmentsRes, sectionsRes] = await Promise.all([
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
              email,
              student_details (
                roll_number,
                year,
                branch,
                section,
                semester
              )
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
        supabase
          .from('faculty_sections')
          .select('year, branch, section')
          .eq('faculty_profile_id', profile.id),
      ]);

      if (submissionsRes.error) throw submissionsRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      setSubmissions(submissionsRes.data as unknown as Submission[] || []);
      setAssignments(assignmentsRes.data || []);

      // Fetch all students in faculty's sections
      if (sectionsRes.data) {
        const studentsPromises = sectionsRes.data.map(async (sec) => {
          const { data } = await supabase
            .from('profiles')
            .select(`
              id,
              full_name,
              email,
              student_details!inner (
                roll_number,
                year,
                branch,
                section,
                semester
              )
            `)
            .eq('role', 'student')
            .eq('student_details.year', sec.year)
            .eq('student_details.branch', sec.branch)
            .eq('student_details.section', sec.section);
          return data || [];
        });
        const studentsResults = await Promise.all(studentsPromises);
        setAllStudents(studentsResults.flat());
      }
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

  // Get student details helper
  const getStudentDetails = (sub: Submission): StudentDetails | null => {
    const details = sub.student_profile?.student_details;
    if (Array.isArray(details)) return details[0] || null;
    return details || null;
  };

  // Build display data - combine submissions with all students for "not submitted" view
  const getDisplayData = () => {
    if (filterSubmitted === 'not_submitted' && filterAssignment !== 'all') {
      // Get students who haven't submitted for selected assignment
      const submittedStudentIds = new Set(
        submissions
          .filter(s => s.assignment.id === filterAssignment)
          .map(s => s.student_profile?.id)
      );
      
      return allStudents
        .filter(student => !submittedStudentIds.has(student.id))
        .map(student => ({
          id: `not-submitted-${student.id}`,
          student_profile: student,
          assignment: assignments.find(a => a.id === filterAssignment),
          status: null,
          marks: null,
          submitted_at: null,
          is_late: null,
          ai_risk_level: null,
          file_url: null,
          notSubmitted: true,
        }));
    }
    return submissions;
  };

  const filteredData = getDisplayData().filter((item: any) => {
    const sub = item as Submission;
    const details = item.notSubmitted 
      ? (item.student_profile?.student_details?.[0] || item.student_profile?.student_details)
      : getStudentDetails(sub);
    
    const matchesSearch =
      item.student_profile?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.student_profile?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      details?.roll_number?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAssignment = filterAssignment === 'all' || sub.assignment?.id === filterAssignment;
    const matchesStatus = filterStatus === 'all' || sub.status === filterStatus;
    const matchesYear = filterYear === 'all' || details?.year?.toString() === filterYear;
    const matchesSemester = filterSemester === 'all' || details?.semester === filterSemester;
    const matchesBranch = filterBranch === 'all' || details?.branch === filterBranch;
    const matchesSection = filterSection === 'all' || details?.section === filterSection;
    const matchesSubmitted = filterSubmitted === 'all' || 
      (filterSubmitted === 'submitted' && !item.notSubmitted) ||
      (filterSubmitted === 'not_submitted' && item.notSubmitted);

    return matchesSearch && matchesAssignment && matchesStatus && matchesYear && matchesSemester && matchesBranch && matchesSection && matchesSubmitted;
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

  const stats = {
    total: submissions.length,
    graded: submissions.filter(s => s.status === 'graded').length,
    pending: submissions.filter(s => s.status === 'pending' || !s.status).length,
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
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-faculty/10">
              <FileText className="w-6 h-6 text-faculty" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Submissions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-green-500/10">
              <CheckCircle className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.graded}</p>
              <p className="text-sm text-muted-foreground">Graded</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-orange-500/10">
              <Clock className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.pending}</p>
              <p className="text-sm text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filter Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, roll number..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={filterAssignment} onValueChange={setFilterAssignment}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Assignment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignments</SelectItem>
                {assignments.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterYear} onValueChange={setFilterYear}>
              <SelectTrigger className="w-[100px]">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y.toString()}>Year {y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSemester} onValueChange={setFilterSemester}>
              <SelectTrigger className="w-[100px]">
                <SelectValue placeholder="Sem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sems</SelectItem>
                {SEMESTERS.map((s) => (
                  <SelectItem key={s} value={s}>Sem {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterBranch} onValueChange={setFilterBranch}>
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {BRANCHES.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSection} onValueChange={setFilterSection}>
              <SelectTrigger className="w-[110px]">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {SECTIONS.map((s) => (
                  <SelectItem key={s} value={s}>Section {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSubmitted} onValueChange={setFilterSubmitted}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Submitted" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="not_submitted">Not Submitted</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[120px]">
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

      {/* Submissions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Submissions</CardTitle>
          <CardDescription>{filteredData.length} record(s) found</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Roll No</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Sem</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      No records found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((item: any) => {
                    const details = item.notSubmitted 
                      ? (item.student_profile?.student_details?.[0] || item.student_profile?.student_details)
                      : getStudentDetails(item as Submission);
                    
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono">{details?.roll_number || '-'}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.student_profile?.full_name}</p>
                            <p className="text-xs text-muted-foreground">{item.student_profile?.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>{item.assignment?.title || '-'}</TableCell>
                        <TableCell>{details?.year || '-'}</TableCell>
                        <TableCell>{details?.semester || '-'}</TableCell>
                        <TableCell>{details?.branch || '-'}</TableCell>
                        <TableCell>{details?.section || '-'}</TableCell>
                        <TableCell>
                          {item.notSubmitted ? (
                            <Badge variant="destructive">Not Submitted</Badge>
                          ) : item.submitted_at ? (
                            <div className="flex items-center gap-2">
                              <Badge className="bg-green-500/10 text-green-600">Submitted</Badge>
                              {item.is_late && <Badge variant="destructive" className="text-xs">Late</Badge>}
                            </div>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          {item.notSubmitted ? '-' : (
                            <Badge variant={item.status === 'graded' ? 'default' : 'outline'}>
                              {item.status || 'Pending'}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.marks !== null && item.marks !== undefined ? (
                            <span className="font-semibold">{item.marks}</span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          {!item.notSubmitted && (
                            <div className="flex justify-end gap-2">
                              {item.file_url && (
                                <Button variant="ghost" size="sm" asChild>
                                  <a href={item.file_url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-4 h-4" />
                                  </a>
                                </Button>
                              )}
                              <Button variant="outline" size="sm" onClick={() => openGradeDialog(item as Submission)}>
                                Grade
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

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
