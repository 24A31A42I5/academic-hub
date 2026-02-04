import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Loader2, Search, FileText, Image, Trash2, Eye, Users, CheckCircle, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { logger } from '@/lib/logger';

const navItems = [
  { label: 'Overview', href: '/admin', icon: DashboardIcons.Home },
  { label: 'Students', href: '/admin/students', icon: DashboardIcons.GraduationCap },
  { label: 'Faculty', href: '/admin/faculty', icon: DashboardIcons.Users },
  { label: 'Assignments', href: '/admin/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Handwriting', href: '/admin/handwriting', icon: DashboardIcons.FileText },
  { label: 'Fraud Reports', href: '/admin/fraud', icon: DashboardIcons.AlertTriangle },
  { label: 'Section Mapping', href: '/admin/sections', icon: DashboardIcons.Settings },
];

const BRANCHES = ['CSE', 'AIML', 'AI', 'DS', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL'];
const YEARS = [1, 2, 3, 4];
const SECTIONS = ['A', 'B', 'C'];
const SEMESTERS = ['I', 'II'];

interface StudentWithHandwriting {
  id: string;
  profile_id: string;
  roll_number: string;
  year: number;
  branch: string;
  section: string;
  semester: string;
  handwriting_url: string | null;
  handwriting_submitted_at: string | null;
  profiles: {
    full_name: string;
    email: string;
    user_id: string;
  };
}

const HandwritingPage = () => {
  const { profile, loading: authLoading } = useAuth();
  const [students, setStudents] = useState<StudentWithHandwriting[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  
  // Filters
  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  // Preview
  const [previewStudent, setPreviewStudent] = useState<StudentWithHandwriting | null>(null);

  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('student_details')
        .select(`
          id,
          profile_id,
          roll_number,
          year,
          branch,
          section,
          semester,
          handwriting_url,
          handwriting_submitted_at,
          profiles!inner (
            full_name,
            email,
            user_id
          )
        `)
        .order('roll_number', { ascending: true });

      if (error) throw error;
      setStudents((data as unknown as StudentWithHandwriting[]) || []);
    } catch (error) {
      logger.error('Error fetching students', error);
      toast.error('Failed to fetch students');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchStudents();
    }
  }, [profile, fetchStudents]);

  const handleDeleteHandwriting = async (student: StudentWithHandwriting) => {
    if (!student.handwriting_url) return;
    
    setDeleting(student.id);
    try {
      // Extract file path from URL
      const urlParts = student.handwriting_url.split('/handwriting-samples/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1].split('?')[0];
        
        // Delete from storage
        const { error: storageError } = await supabase.storage
          .from('handwriting-samples')
          .remove([filePath]);
        
        if (storageError) {
          logger.error('Error deleting from storage', storageError);
        }
      }

      // Clear handwriting from student_details
      const { error } = await supabase
        .from('student_details')
        .update({
          handwriting_url: null,
          handwriting_submitted_at: null,
          handwriting_image_hash: null,
          handwriting_feature_embedding: null,
          handwriting_features_extracted_at: null,
        })
        .eq('id', student.id);

      if (error) throw error;

      toast.success('Handwriting sample deleted successfully');
      fetchStudents();
    } catch (error) {
      logger.error('Error deleting handwriting', error);
      toast.error('Failed to delete handwriting sample');
    } finally {
      setDeleting(null);
    }
  };

  const filteredStudents = students.filter(student => {
    const matchesSearch = 
      student.profiles.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.profiles.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.roll_number.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesYear = filterYear === 'all' || student.year.toString() === filterYear;
    const matchesSemester = filterSemester === 'all' || student.semester === filterSemester;
    const matchesBranch = filterBranch === 'all' || student.branch === filterBranch;
    const matchesSection = filterSection === 'all' || student.section === filterSection;
    const matchesStatus = filterStatus === 'all' || 
      (filterStatus === 'submitted' && student.handwriting_url) ||
      (filterStatus === 'not_submitted' && !student.handwriting_url);

    return matchesSearch && matchesYear && matchesSemester && matchesBranch && matchesSection && matchesStatus;
  });

  const stats = {
    total: students.length,
    submitted: students.filter(s => s.handwriting_url).length,
    notSubmitted: students.filter(s => !s.handwriting_url).length,
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
    <DashboardLayout title="Handwriting Management" role="admin" navItems={navItems}>
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-primary/10">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Students</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-green-500/10">
              <CheckCircle className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.submitted}</p>
              <p className="text-sm text-muted-foreground">Submitted</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-orange-500/10">
              <XCircle className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.notSubmitted}</p>
              <p className="text-sm text-muted-foreground">Not Submitted</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filter Students</CardTitle>
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
            <Select value={filterYear} onValueChange={setFilterYear}>
              <SelectTrigger className="w-[120px]">
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
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Semester" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sems</SelectItem>
                {SEMESTERS.map((s) => (
                  <SelectItem key={s} value={s}>Sem {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterBranch} onValueChange={setFilterBranch}>
              <SelectTrigger className="w-[120px]">
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
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {SECTIONS.map((s) => (
                  <SelectItem key={s} value={s}>Section {s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="not_submitted">Not Submitted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Students Table */}
      <Card>
        <CardHeader>
          <CardTitle>Student Handwriting Samples</CardTitle>
          <CardDescription>
            {filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Roll Number</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Sem</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No students found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStudents.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell className="font-mono">{student.roll_number}</TableCell>
                      <TableCell className="font-medium">{student.profiles.full_name}</TableCell>
                      <TableCell>{student.profiles.email}</TableCell>
                      <TableCell>{student.year}</TableCell>
                      <TableCell>{student.semester}</TableCell>
                      <TableCell>{student.branch}</TableCell>
                      <TableCell>{student.section}</TableCell>
                      <TableCell>
                        {student.handwriting_url ? (
                          <Badge className="bg-green-500/10 text-green-600">Submitted</Badge>
                        ) : (
                          <Badge variant="outline">Not Submitted</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {student.handwriting_submitted_at
                          ? format(new Date(student.handwriting_submitted_at), 'MMM d, yyyy')
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {student.handwriting_url && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setPreviewStudent(student)}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive hover:text-destructive"
                                    disabled={deleting === student.id}
                                  >
                                    {deleting === student.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-4 h-4" />
                                    )}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Handwriting Sample</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete the handwriting sample for{' '}
                                      <strong>{student.profiles.full_name}</strong> ({student.roll_number})?
                                      <br /><br />
                                      This will allow the student to upload a new handwriting sample.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteHandwriting(student)}>
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewStudent} onOpenChange={() => setPreviewStudent(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Handwriting Sample</DialogTitle>
          </DialogHeader>
          {previewStudent && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>{' '}
                    <span className="font-medium">{previewStudent.profiles.full_name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Roll Number:</span>{' '}
                    <span className="font-mono">{previewStudent.roll_number}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Class:</span>{' '}
                    <span>Year {previewStudent.year} - Sem {previewStudent.semester} - {previewStudent.branch} - Section {previewStudent.section}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Submitted:</span>{' '}
                    <span>{previewStudent.handwriting_submitted_at
                      ? format(new Date(previewStudent.handwriting_submitted_at), 'MMM d, yyyy h:mm a')
                      : 'Unknown'}</span>
                  </div>
                </div>
              </div>
              
              {previewStudent.handwriting_url && (
                <div className="border rounded-lg overflow-hidden">
                  <img
                    src={`${previewStudent.handwriting_url}?v=${previewStudent.handwriting_submitted_at || Date.now()}`}
                    alt="Handwriting sample"
                    className="w-full h-auto max-h-[60vh] object-contain bg-muted"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewStudent(null)}>
              Close
            </Button>
            {previewStudent?.handwriting_url && (
              <Button asChild>
                <a href={previewStudent.handwriting_url} target="_blank" rel="noopener noreferrer">
                  <Image className="w-4 h-4 mr-2" />
                  Open Full Size
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HandwritingPage;
