import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, BookOpen, FileText, Clock, Users, AlertTriangle, CheckCircle } from 'lucide-react';
import { logger } from '@/lib/logger';

const navItems = [
  { label: 'Overview', href: '/admin', icon: DashboardIcons.Home },
  { label: 'Students', href: '/admin/students', icon: DashboardIcons.GraduationCap },
  { label: 'Faculty', href: '/admin/faculty', icon: DashboardIcons.Users },
  { label: 'Assignments', href: '/admin/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Fraud Reports', href: '/admin/fraud', icon: DashboardIcons.AlertTriangle },
  { label: 'Section Mapping', href: '/admin/sections', icon: DashboardIcons.Settings },
];

const BRANCHES = ['CSE', 'AIML', 'AI', 'DS', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL'];
const YEARS = [1, 2, 3, 4];
const SECTIONS = ['A', 'B', 'C'];
const SEMESTERS = ['I', 'II'];

interface Submission {
  id: string;
  student_profile_id: string;
  submitted_at: string;
  status: string | null;
  marks: number | null;
  is_late: boolean | null;
  ai_risk_level: string | null;
  file_url: string;
  profiles: {
    full_name: string;
    email: string;
  } | null;
}

interface Assignment {
  id: string;
  title: string;
  description: string | null;
  deadline: string;
  year: number;
  branch: string;
  section: string;
  created_at: string;
  faculty_profile_id: string;
  profiles: {
    full_name: string;
  } | null;
  submissions: Submission[];
}

const AssignmentsPage = () => {
  const { profile, loading: authLoading } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');

  const fetchAssignments = useCallback(async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('assignments')
        .select(`
          id,
          title,
          description,
          deadline,
          year,
          branch,
          section,
          created_at,
          faculty_profile_id,
          profiles:faculty_profile_id (
            full_name
          ),
          submissions (
            id,
            student_profile_id,
            submitted_at,
            status,
            marks,
            is_late,
            ai_risk_level,
            file_url,
            profiles:student_profile_id (
              full_name,
              email
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAssignments((data as unknown as Assignment[]) || []);
    } catch (error) {
      logger.error('Error fetching assignments', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchAssignments();
    }
  }, [profile, fetchAssignments]);

  const filteredAssignments = assignments.filter(a => {
    const matchesYear = filterYear === 'all' || a.year.toString() === filterYear;
    const matchesBranch = filterBranch === 'all' || a.branch === filterBranch;
    const matchesSection = filterSection === 'all' || a.section === filterSection;
    const matchesSemester = filterSemester === 'all'; // No semester in assignment table yet, filter disabled
    return matchesYear && matchesBranch && matchesSection && matchesSemester;
  });

  const stats = {
    total: assignments.length,
    totalSubmissions: assignments.reduce((acc, a) => acc + a.submissions.length, 0),
    flagged: assignments.reduce((acc, a) => acc + a.submissions.filter(s => s.ai_risk_level === 'high' || s.ai_risk_level === 'medium').length, 0),
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'graded':
        return <Badge className="bg-green-500/10 text-green-600">Graded</Badge>;
      case 'reviewed':
        return <Badge className="bg-blue-500/10 text-blue-600">Reviewed</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const getRiskBadge = (risk: string | null) => {
    switch (risk) {
      case 'high':
        return <Badge className="bg-red-500/10 text-red-600"><AlertTriangle className="w-3 h-3 mr-1" />High</Badge>;
      case 'medium':
        return <Badge className="bg-orange-500/10 text-orange-600"><AlertTriangle className="w-3 h-3 mr-1" />Medium</Badge>;
      default:
        return <Badge className="bg-green-500/10 text-green-600"><CheckCircle className="w-3 h-3 mr-1" />Low</Badge>;
    }
  };

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
    <DashboardLayout title="Assignments Overview" role="admin" navItems={navItems}>
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-primary/10">
              <BookOpen className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Assignments</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-blue-500/10">
              <FileText className="w-6 h-6 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalSubmissions}</p>
              <p className="text-sm text-muted-foreground">Total Submissions</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-orange-500/10">
              <AlertTriangle className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.flagged}</p>
              <p className="text-sm text-muted-foreground">Flagged Submissions</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filter Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Select value={filterYear} onValueChange={setFilterYear}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y.toString()}>Year {y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterBranch} onValueChange={setFilterBranch}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {BRANCHES.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSemester} onValueChange={setFilterSemester}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Semester" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Semesters</SelectItem>
                {SEMESTERS.map((s) => (
                  <SelectItem key={s} value={s}>Sem {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSection} onValueChange={setFilterSection}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {SECTIONS.map((s) => (
                  <SelectItem key={s} value={s}>Section {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Assignments List */}
      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
          <CardDescription>
            {filteredAssignments.length} assignment{filteredAssignments.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredAssignments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No assignments found for the selected filters.
            </div>
          ) : (
            <Accordion type="single" collapsible className="space-y-4">
              {filteredAssignments.map((assignment) => (
                <AccordionItem key={assignment.id} value={assignment.id} className="border rounded-lg px-4">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex flex-col items-start gap-2 text-left w-full pr-4">
                      <div className="flex items-center gap-2 w-full">
                        <span className="font-semibold">{assignment.title}</span>
                        <Badge variant="outline">Year {assignment.year}</Badge>
                        <Badge>{assignment.branch}</Badge>
                        <Badge variant="secondary">{assignment.section}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          {assignment.submissions.length} submissions
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          Due: {new Date(assignment.deadline).toLocaleDateString()}
                        </span>
                        <span>By: {assignment.profiles?.full_name || 'Unknown'}</span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pt-4">
                      {assignment.description && (
                        <p className="text-sm text-muted-foreground mb-4">{assignment.description}</p>
                      )}
                      
                      {assignment.submissions.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground">
                          No submissions yet
                        </div>
                      ) : (
                        <div className="rounded-lg border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Student</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Submitted</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Marks</TableHead>
                                <TableHead>AI Risk</TableHead>
                                <TableHead>Late</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {assignment.submissions.map((sub) => (
                                <TableRow key={sub.id}>
                                  <TableCell className="font-medium">{sub.profiles?.full_name || '-'}</TableCell>
                                  <TableCell>{sub.profiles?.email || '-'}</TableCell>
                                  <TableCell>{new Date(sub.submitted_at).toLocaleString()}</TableCell>
                                  <TableCell>{getStatusBadge(sub.status)}</TableCell>
                                  <TableCell>{sub.marks !== null ? sub.marks : '-'}</TableCell>
                                  <TableCell>{getRiskBadge(sub.ai_risk_level)}</TableCell>
                                  <TableCell>
                                    {sub.is_late ? (
                                      <Badge className="bg-red-500/10 text-red-600">Late</Badge>
                                    ) : (
                                      <Badge className="bg-green-500/10 text-green-600">On Time</Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default AssignmentsPage;
