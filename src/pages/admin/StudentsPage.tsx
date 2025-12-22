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
import { toast } from 'sonner';
import { Loader2, Upload, Search, Users, CheckCircle, XCircle, FileSpreadsheet, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
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

interface StudentDetails {
  roll_number: string;
  year: number;
  branch: string;
  section: string;
  has_logged_in: boolean;
}

interface Student {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
  student_details: StudentDetails | StudentDetails[] | null;
}

interface ParsedStudent {
  full_name: string;
  email: string;
  password: string;
  roll_number: string;
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
  const [filterStatus, setFilterStatus] = useState<string>('all');
  
  // Bulk upload form
  const [uploadYear, setUploadYear] = useState<string>('');
  const [uploadBranch, setUploadBranch] = useState<string>('');
  const [uploadSection, setUploadSection] = useState<string>('');
  const [parsedStudents, setParsedStudents] = useState<ParsedStudent[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('profiles')
        .select(`
          id,
          full_name,
          email,
          created_at,
          student_details (
            roll_number,
            year,
            branch,
            section,
            has_logged_in
          )
        `)
        .eq('role', 'student')
        .order('created_at', { ascending: false });

      const { data, error } = await query;

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

    if (!uploadYear || !uploadBranch || !uploadSection) {
      toast.error('Please select Year, Branch, and Section before uploading');
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
      })).filter(s => s.full_name && s.email && s.roll_number && s.password);

      if (parsed.length === 0) {
        toast.error('No valid student data found. Ensure columns: Name, Email, Password, Roll Number');
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
    if (!uploadYear || !uploadBranch || !uploadSection) {
      toast.error('Please select Year, Branch, and Section');
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
        logger.error('Failed accounts count', results.failed.length);
      }

      setParsedStudents([]);
      setShowPreview(false);
      setUploadYear('');
      setUploadBranch('');
      setUploadSection('');
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
      { Name: 'John Doe', Email: 'john@example.com', Password: 'Secure@Pass1', 'Roll Number': 'CS001' },
      { Name: 'Jane Smith', Email: 'jane@example.com', Password: 'Strong#Pass2', 'Roll Number': 'CS002' },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, 'student_template.xlsx');
  };

  // Helper to get student details
  const getDetails = (student: Student): StudentDetails | null => {
    if (!student.student_details) return null;
    if (Array.isArray(student.student_details)) return student.student_details[0] || null;
    return student.student_details;
  };

  // Filter students
  const filteredStudents = students.filter(student => {
    const details = getDetails(student);
    
    const matchesSearch = 
      student.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      student.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      details?.roll_number?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesYear = filterYear === 'all' || details?.year?.toString() === filterYear;
    const matchesBranch = filterBranch === 'all' || details?.branch === filterBranch;
    const matchesSection = filterSection === 'all' || details?.section === filterSection;
    const matchesStatus = filterStatus === 'all' || 
      (filterStatus === 'registered' && details?.has_logged_in) ||
      (filterStatus === 'not_registered' && !details?.has_logged_in);

    return matchesSearch && matchesYear && matchesBranch && matchesSection && matchesStatus;
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
            Excel file must have columns: <strong>Name, Email, Password, Roll Number</strong>. Select Year, Branch, and Section below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
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
                  disabled={!uploadYear || !uploadBranch || !uploadSection}
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedStudents.slice(0, 10).map((student, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{student.full_name}</TableCell>
                        <TableCell>{student.email}</TableCell>
                        <TableCell className="font-mono text-xs">{student.password}</TableCell>
                        <TableCell>{student.roll_number}</TableCell>
                      </TableRow>
                    ))}
                    {parsedStudents.length > 10 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
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
                  <TableHead>Roll Number</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No students found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStudents.map((student) => {
                    const details = getDetails(student);
                    return (
                      <TableRow key={student.id}>
                        <TableCell className="font-medium">{student.full_name}</TableCell>
                        <TableCell>{student.email}</TableCell>
                        <TableCell>{details?.roll_number || '-'}</TableCell>
                        <TableCell>{details?.year || '-'}</TableCell>
                        <TableCell>{details?.branch || '-'}</TableCell>
                        <TableCell>{details?.section || '-'}</TableCell>
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
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default StudentsPage;
