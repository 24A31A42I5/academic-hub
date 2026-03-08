import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Loader2, Upload, Search, Users, CheckCircle, XCircle, FileSpreadsheet, Download, Pencil, Trash2, RotateCcw, FileEdit } from 'lucide-react';
import * as XLSX from 'xlsx';
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

interface StudentDetails {
  roll_number: string;
  year: number;
  branch: string;
  section: string;
  semester: string;
  has_logged_in: boolean;
  handwriting_url: string | null;
  phone_number: string | null;
}

interface Student {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  created_at: string;
  user_id: string;
  student_details: StudentDetails | StudentDetails[] | null;
}

interface ParsedStudent {
  full_name: string;
  email: string;
  password: string;
  roll_number: string;
  phone_number: string;
}

const StudentsPage = () => {
  const { profile, loading: authLoading } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Filters
  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  // Bulk upload form
  const [uploadYear, setUploadYear] = useState<string>('');
  const [uploadBranch, setUploadBranch] = useState<string>('');
  const [uploadSection, setUploadSection] = useState<string>('');
  const [uploadSemester, setUploadSemester] = useState<string>('');
  const [parsedStudents, setParsedStudents] = useState<ParsedStudent[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // Bulk change state
  const [showBulkChange, setShowBulkChange] = useState(false);
  const [bulkFromYear, setBulkFromYear] = useState<string>('');
  const [bulkFromSemester, setBulkFromSemester] = useState<string>('');
  const [bulkToYear, setBulkToYear] = useState<string>('');
  const [bulkToSemester, setBulkToSemester] = useState<string>('');
  const [bulkChanging, setBulkChanging] = useState(false);

  // Edit dialog
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', email: '', phone_number: '', year: '', branch: '', section: '', semester: '', roll_number: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          user_id,
          full_name,
          email,
          phone_number,
          created_at,
          student_details (
            roll_number,
            year,
            branch,
            section,
            semester,
            has_logged_in,
            handwriting_url,
            phone_number
          )
        `)
        .eq('role', 'student')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStudents(data || []);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!uploadYear || !uploadBranch || !uploadSection || !uploadSemester) {
      toast.error('Please select Year, Semester, Branch, and Section before uploading');
      return;
    }

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet);

      const parsed: ParsedStudent[] = jsonData.map((row) => ({
        full_name: row['Name'] || row['name'] || row['Full Name'] || row['full_name'] || '',
        email: row['Email'] || row['email'] || row['Mail'] || row['mail'] || '',
        password: row['Password'] || row['password'] || '',
        roll_number: row['Roll Number'] || row['roll_number'] || row['Roll'] || row['roll'] || '',
        phone_number: row['Phone Number'] || row['phone_number'] || row['Phone'] || row['phone'] || row['Mobile'] || row['mobile'] || '',
      })).filter(s => s.full_name && s.email && s.roll_number && s.password);

      if (parsed.length === 0) {
        toast.error('No valid student data found. Ensure columns: Name, Email, Password, Roll Number, Phone Number');
        return;
      }

      setParsedStudents(parsed);
      setShowPreview(true);
      toast.success(`Found ${parsed.length} students in the file`);
    } catch (error) {
      logger.error('Error parsing file', error);
      toast.error('Failed to parse Excel file');
    }
  };

  const handleBulkCreate = async () => {
    if (!uploadYear || !uploadBranch || !uploadSection || !uploadSemester) {
      toast.error('Please select Year, Semester, Branch, and Section');
      return;
    }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const studentsData = parsedStudents.map(s => ({
        ...s,
        year: parseInt(uploadYear),
        branch: uploadBranch,
        section: uploadSection,
        semester: uploadSemester,
      }));

      const response = await supabase.functions.invoke('bulk-create-students', {
        body: { students: studentsData },
      });

      if (response.error) throw response.error;

      const results = response.data;
      
      if (results.success.length > 0) {
        toast.success(`Successfully created ${results.success.length} student accounts`);
      }
      
      if (results.failed.length > 0) {
        toast.error(`Failed to create ${results.failed.length} accounts`);
      }

      setParsedStudents([]);
      setShowPreview(false);
      setUploadYear('');
      setUploadBranch('');
      setUploadSection('');
      setUploadSemester('');
      fetchStudents();
    } catch (error) {
      logger.error('Error creating students', error);
      toast.error('Failed to create student accounts');
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const template = [
      { Name: 'John Doe', Email: 'john@example.com', Password: 'Secure@Pass1', 'Roll Number': 'CS001', 'Phone Number': '9876543210' },
      { Name: 'Jane Smith', Email: 'jane@example.com', Password: 'Strong#Pass2', 'Roll Number': 'CS002', 'Phone Number': '9876543211' },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, 'student_template.xlsx');
  };

  const getDetails = (student: Student): StudentDetails | null => {
    if (!student.student_details) return null;
    if (Array.isArray(student.student_details)) return student.student_details[0] || null;
    return student.student_details;
  };

  const handleEdit = (student: Student) => {
    const details = getDetails(student);
    setEditStudent(student);
    setEditForm({
      full_name: student.full_name,
      email: student.email,
      phone_number: student.phone_number || details?.phone_number || '',
      year: details?.year?.toString() || '',
      branch: details?.branch || '',
      section: details?.section || '',
      semester: details?.semester || 'I',
      roll_number: details?.roll_number || '',
      password: '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editStudent) return;
    setSaving(true);
    try {
      // Update profile (name, email, phone)
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          full_name: editForm.full_name,
          email: editForm.email,
          phone_number: editForm.phone_number || null
        })
        .eq('id', editStudent.id);

      if (profileError) throw profileError;

      // Update student details (also update phone_number there for SMS)
      const { error: detailsError } = await supabase
        .from('student_details')
        .update({
          year: parseInt(editForm.year),
          branch: editForm.branch,
          section: editForm.section,
          semester: editForm.semester,
          roll_number: editForm.roll_number,
          phone_number: editForm.phone_number || null,
        })
        .eq('profile_id', editStudent.id);

      if (detailsError) throw detailsError;

      toast.success('Student updated successfully');
      setEditStudent(null);
      fetchStudents();
    } catch (error) {
      logger.error('Error updating student', error);
      toast.error('Failed to update student');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (student: Student) => {
    setDeleting(student.id);
    try {
      // Delete student details first
      await supabase.from('student_details').delete().eq('profile_id', student.id);
      
      // Delete user role
      await supabase.from('user_roles').delete().eq('user_id', student.user_id);
      
      // Delete profile
      const { error } = await supabase.from('profiles').delete().eq('id', student.id);
      if (error) throw error;

      toast.success('Student deleted successfully');
      fetchStudents();
    } catch (error) {
      logger.error('Error deleting student', error);
      toast.error('Failed to delete student');
    } finally {
      setDeleting(null);
    }
  };

  const handleResetHandwriting = async (student: Student) => {
    try {
      const { error } = await supabase
        .from('student_details')
        .update({ 
          handwriting_url: null, 
          handwriting_submitted_at: null 
        })
        .eq('profile_id', student.id);

      if (error) throw error;

      toast.success(`Handwriting reset for ${student.full_name}. Student can now re-upload.`);
      fetchStudents();
    } catch (error) {
      logger.error('Error resetting handwriting', error);
      toast.error('Failed to reset handwriting');
    }
  };

  const handleBulkYearSemChange = async () => {
    if (!bulkFromYear || !bulkFromSemester || !bulkToYear || !bulkToSemester) {
      toast.error('Please fill all fields');
      return;
    }

    setBulkChanging(true);
    try {
      const { data, error } = await supabase
        .from('student_details')
        .update({ year: parseInt(bulkToYear), semester: bulkToSemester })
        .eq('year', parseInt(bulkFromYear))
        .eq('semester', bulkFromSemester)
        .select();

      if (error) throw error;

      toast.success(`Updated ${data?.length || 0} students from Year ${bulkFromYear} Sem ${bulkFromSemester} to Year ${bulkToYear} Sem ${bulkToSemester}`);
      setShowBulkChange(false);
      setBulkFromYear('');
      setBulkFromSemester('');
      setBulkToYear('');
      setBulkToSemester('');
      fetchStudents();
    } catch (error) {
      logger.error('Error bulk updating students', error);
      toast.error('Failed to bulk update students');
    } finally {
      setBulkChanging(false);
    }
  };

  const filteredStudents = students.filter(student => {
    const details = getDetails(student);
    
    const matchesSearch = 
      student.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      details?.roll_number?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesYear = filterYear === 'all' || details?.year?.toString() === filterYear;
    const matchesSemester = filterSemester === 'all' || details?.semester === filterSemester;
    const matchesBranch = filterBranch === 'all' || details?.branch === filterBranch;
    const matchesSection = filterSection === 'all' || details?.section === filterSection;
    const matchesStatus = filterStatus === 'all' || 
      (filterStatus === 'registered' && details?.has_logged_in) ||
      (filterStatus === 'not_registered' && !details?.has_logged_in);

    return matchesSearch && matchesYear && matchesSemester && matchesBranch && matchesSection && matchesStatus;
  });

  const stats = {
    total: students.length,
    registered: students.filter(s => getDetails(s)?.has_logged_in).length,
    notRegistered: students.filter(s => !getDetails(s)?.has_logged_in).length,
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
    <DashboardLayout title="Student Management" role="admin" navItems={navItems}>
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-student/10">
              <Users className="w-6 h-6 text-student" />
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
              <p className="text-2xl font-bold">{stats.registered}</p>
              <p className="text-sm text-muted-foreground">Logged In</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-orange-500/10">
              <XCircle className="w-6 h-6 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.notRegistered}</p>
              <p className="text-sm text-muted-foreground">Not Logged In</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bulk Upload Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Bulk Student Registration
          </CardTitle>
          <CardDescription>
            Excel file must have columns: <strong>Name, Email, Password, Roll Number, Phone Number</strong>. Select Year, Semester, Branch, and Section below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
            <div>
              <Label htmlFor="upload-year">Year</Label>
              <Select value={uploadYear} onValueChange={setUploadYear}>
                <SelectTrigger id="upload-year">
                  <SelectValue placeholder="Select Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((year) => (
                    <SelectItem key={year} value={year.toString()}>
                      Year {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="upload-semester">Semester</Label>
              <Select value={uploadSemester} onValueChange={setUploadSemester}>
                <SelectTrigger id="upload-semester">
                  <SelectValue placeholder="Select Sem" />
                </SelectTrigger>
                <SelectContent>
                  {SEMESTERS.map((sem) => (
                    <SelectItem key={sem} value={sem}>
                      Sem {sem}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="upload-branch">Branch</Label>
              <Select value={uploadBranch} onValueChange={setUploadBranch}>
                <SelectTrigger id="upload-branch">
                  <SelectValue placeholder="Select Branch" />
                </SelectTrigger>
                <SelectContent>
                  {BRANCHES.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="upload-section">Section</Label>
              <Select value={uploadSection} onValueChange={setUploadSection}>
                <SelectTrigger id="upload-section">
                  <SelectValue placeholder="Select Section" />
                </SelectTrigger>
                <SelectContent>
                  {SECTIONS.map((section) => (
                    <SelectItem key={section} value={section}>
                      Section {section}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="file-upload" className="sr-only">Upload Excel</Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="cursor-pointer"
                  disabled={!uploadYear || !uploadBranch || !uploadSection || !uploadSemester}
                />
              </div>
              <Button variant="outline" size="icon" onClick={downloadTemplate} title="Download Template">
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {showPreview && parsedStudents.length > 0 && (
            <div className="border rounded-lg p-4 bg-muted/50">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-medium">Preview ({parsedStudents.length} students)</h4>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setParsedStudents([]); setShowPreview(false); }}>
                    Cancel
                  </Button>
                  <Button variant="admin" onClick={handleBulkCreate} disabled={uploading}>
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Create {parsedStudents.length} Accounts
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="max-h-48 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Password</TableHead>
                      <TableHead>Roll Number</TableHead>
                      <TableHead>Phone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedStudents.slice(0, 10).map((student, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{student.full_name}</TableCell>
                        <TableCell>{student.email}</TableCell>
                        <TableCell className="font-mono text-xs">{student.password}</TableCell>
                        <TableCell>{student.roll_number}</TableCell>
                        <TableCell>{student.phone_number || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {parsedStudents.length > 10 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          ... and {parsedStudents.length - 10} more
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Year/Semester Change Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Bulk Year/Semester Change
            </span>
            <Button variant="outline" size="sm" onClick={() => setShowBulkChange(!showBulkChange)}>
              {showBulkChange ? 'Hide' : 'Show'}
            </Button>
          </CardTitle>
          <CardDescription>
            Move all students from one year/semester to another
          </CardDescription>
        </CardHeader>
        {showBulkChange && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
              <div>
                <Label>From Year</Label>
                <Select value={bulkFromYear} onValueChange={setBulkFromYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={y.toString()}>Year {y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>From Semester</Label>
                <Select value={bulkFromSemester} onValueChange={setBulkFromSemester}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sem" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEMESTERS.map((s) => (
                      <SelectItem key={s} value={s}>Sem {s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To Year</Label>
                <Select value={bulkToYear} onValueChange={setBulkToYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={y.toString()}>Year {y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To Semester</Label>
                <Select value={bulkToSemester} onValueChange={setBulkToSemester}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sem" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEMESTERS.map((s) => (
                      <SelectItem key={s} value={s}>Sem {s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button 
                variant="admin" 
                onClick={handleBulkYearSemChange} 
                disabled={bulkChanging || !bulkFromYear || !bulkFromSemester || !bulkToYear || !bulkToSemester}
              >
                {bulkChanging ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Apply Change
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Students List */}
      <Card>
        <CardHeader>
          <CardTitle>All Students</CardTitle>
          <CardDescription>View and manage all registered students</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or roll number..."
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
                {YEARS.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    Year {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSemester} onValueChange={setFilterSemester}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Semester" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Semesters</SelectItem>
                {SEMESTERS.map((sem) => (
                  <SelectItem key={sem} value={sem}>
                    Sem {sem}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterBranch} onValueChange={setFilterBranch}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {BRANCHES.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSection} onValueChange={setFilterSection}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sections</SelectItem>
                {SECTIONS.map((section) => (
                  <SelectItem key={section} value={section}>
                    Section {section}
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
                <SelectItem value="registered">Logged In</SelectItem>
                <SelectItem value="not_registered">Not Logged In</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Students Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Roll Number</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Sem</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Handwriting</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      No students found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStudents.map((student) => {
                    const details = getDetails(student);
                    return (
                      <TableRow key={student.id}>
                        <TableCell className="font-medium">{student.full_name}</TableCell>
                        <TableCell className="text-xs">{student.email}</TableCell>
                        <TableCell className="text-xs">{student.phone_number || details?.phone_number || '-'}</TableCell>
                        <TableCell>{details?.roll_number || '-'}</TableCell>
                        <TableCell>{details?.year || '-'}</TableCell>
                        <TableCell>{details?.semester || '-'}</TableCell>
                        <TableCell>{details?.branch || '-'}</TableCell>
                        <TableCell>{details?.section || '-'}</TableCell>
                        <TableCell>
                          {details?.handwriting_url ? (
                            <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
                              <FileEdit className="w-3 h-3 mr-1" />
                              Uploaded
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              <XCircle className="w-3 h-3 mr-1" />
                              Not Uploaded
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {details?.has_logged_in ? (
                            <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Logged In
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-orange-500 border-orange-500/50">
                              <XCircle className="w-3 h-3 mr-1" />
                              Not Logged In
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(student)} title="Edit Student">
                              <Pencil className="w-4 h-4" />
                            </Button>
                            {details?.handwriting_url && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="text-amber-600 hover:text-amber-700" title="Reset Handwriting">
                                    <RotateCcw className="w-4 h-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Reset Handwriting</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will clear the handwriting sample for {student.full_name} and allow them to upload a new one. Continue?
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleResetHandwriting(student)}>
                                      Reset Handwriting
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" title="Delete Student">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Student</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete {student.full_name}? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(student)} disabled={deleting === student.id}>
                                    {deleting === student.id ? 'Deleting...' : 'Delete'}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
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

      {/* Edit Dialog */}
      <Dialog open={!!editStudent} onOpenChange={() => setEditStudent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Full Name</Label>
                <Input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
              </div>
              <div>
                <Label>Roll Number</Label>
                <Input value={editForm.roll_number} onChange={(e) => setEditForm({ ...editForm, roll_number: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div>
                <Label>Phone Number</Label>
                <Input value={editForm.phone_number} onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })} placeholder="e.g. 9876543210" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Year</Label>
                <Select value={editForm.year} onValueChange={(v) => setEditForm({ ...editForm, year: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => <SelectItem key={y} value={y.toString()}>Year {y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Semester</Label>
                <Select value={editForm.semester} onValueChange={(v) => setEditForm({ ...editForm, semester: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEMESTERS.map((s) => <SelectItem key={s} value={s}>Sem {s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Branch</Label>
                <Select value={editForm.branch} onValueChange={(v) => setEditForm({ ...editForm, branch: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BRANCHES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Section</Label>
                <Select value={editForm.section} onValueChange={(v) => setEditForm({ ...editForm, section: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SECTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStudent(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default StudentsPage;
