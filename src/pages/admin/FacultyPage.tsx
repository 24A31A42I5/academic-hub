import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Loader2, Upload, Search, Users, FileSpreadsheet, Download, UserPlus } from 'lucide-react';
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

interface FacultyDetails {
  faculty_id: string;
}

interface Faculty {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
  faculty_details: FacultyDetails | FacultyDetails[] | null;
}

interface ParsedFaculty {
  full_name: string;
  email: string;
  password: string;
  faculty_id: string;
}

const FacultyPage = () => {
  const { profile, loading: authLoading } = useAuth();
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Bulk upload
  const [parsedFaculty, setParsedFaculty] = useState<ParsedFaculty[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  
  // Single registration
  const [showSingleForm, setShowSingleForm] = useState(false);
  const [singleFaculty, setSingleFaculty] = useState({
    full_name: '',
    email: '',
    password: '',
    faculty_id: '',
  });
  const [creatingOne, setCreatingOne] = useState(false);

  const fetchFaculty = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          full_name,
          email,
          created_at,
          faculty_details (
            faculty_id
          )
        `)
        .eq('role', 'faculty')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFaculty(data || []);
    } catch (error) {
      logger.error('Error fetching faculty', error);
      toast.error('Failed to fetch faculty');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchFaculty();
    }
  }, [profile, fetchFaculty]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet);

      const parsed: ParsedFaculty[] = jsonData.map((row) => ({
        full_name: row['Name'] || row['name'] || row['Full Name'] || row['full_name'] || '',
        email: row['Email'] || row['email'] || row['Mail'] || row['mail'] || '',
        password: row['Password'] || row['password'] || '',
        faculty_id: row['Faculty ID'] || row['faculty_id'] || row['ID'] || row['id'] || '',
      })).filter(f => f.full_name && f.email && f.password && f.faculty_id);

      if (parsed.length === 0) {
        toast.error('No valid faculty data found. Ensure columns: Name, Email, Password, Faculty ID');
        return;
      }

      setParsedFaculty(parsed);
      setShowPreview(true);
      toast.success(`Found ${parsed.length} faculty in the file`);
    } catch (error) {
      logger.error('Error parsing file', error);
      toast.error('Failed to parse Excel file');
    }
  };

  const handleBulkCreate = async () => {
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('bulk-create-faculty', {
        body: { faculty: parsedFaculty },
      });

      if (response.error) throw response.error;

      const results = response.data;
      
      if (results.success.length > 0) {
        toast.success(`Successfully created ${results.success.length} faculty accounts`);
      }
      
      if (results.failed.length > 0) {
        toast.error(`Failed to create ${results.failed.length} accounts`);
        logger.error('Failed accounts count', results.failed.length);
      }

      setParsedFaculty([]);
      setShowPreview(false);
      fetchFaculty();
    } catch (error) {
      logger.error('Error creating faculty', error);
      toast.error('Failed to create faculty accounts');
    } finally {
      setUploading(false);
    }
  };

  const handleSingleCreate = async () => {
    if (!singleFaculty.full_name || !singleFaculty.email || !singleFaculty.password || !singleFaculty.faculty_id) {
      toast.error('Please fill all fields');
      return;
    }

    setCreatingOne(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('bulk-create-faculty', {
        body: { faculty: [singleFaculty] },
      });

      if (response.error) throw response.error;

      const results = response.data;
      
      if (results.success.length > 0) {
        toast.success('Faculty account created successfully');
        setSingleFaculty({ full_name: '', email: '', password: '', faculty_id: '' });
        setShowSingleForm(false);
        fetchFaculty();
      } else {
        toast.error('Failed to create faculty account');
      }
    } catch (error) {
      logger.error('Error creating faculty', error);
      toast.error('Failed to create faculty account');
    } finally {
      setCreatingOne(false);
    }
  };

  const downloadTemplate = () => {
    const template = [
      { Name: 'Dr. John Smith', Email: 'john.smith@college.edu', Password: 'Faculty@123', 'Faculty ID': 'FAC001' },
      { Name: 'Dr. Jane Doe', Email: 'jane.doe@college.edu', Password: 'Faculty@456', 'Faculty ID': 'FAC002' },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Faculty');
    XLSX.writeFile(wb, 'faculty_template.xlsx');
  };

  const getDetails = (f: Faculty): FacultyDetails | null => {
    if (!f.faculty_details) return null;
    if (Array.isArray(f.faculty_details)) return f.faculty_details[0] || null;
    return f.faculty_details;
  };

  const filteredFaculty = faculty.filter(f => {
    const details = getDetails(f);
    return (
      f.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      details?.faculty_id?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

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
    <DashboardLayout title="Faculty Management" role="admin" navItems={navItems}>
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-faculty/10">
              <Users className="w-6 h-6 text-faculty" />
            </div>
            <div>
              <p className="text-2xl font-bold">{faculty.length}</p>
              <p className="text-sm text-muted-foreground">Total Faculty</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <Button variant="outline" onClick={() => setShowSingleForm(!showSingleForm)} className="w-full">
              <UserPlus className="w-4 h-4 mr-2" />
              {showSingleForm ? 'Hide Single Registration' : 'Add Single Faculty'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Single Registration Form */}
      {showSingleForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Single Faculty Registration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="single-name">Full Name</Label>
                <Input
                  id="single-name"
                  value={singleFaculty.full_name}
                  onChange={(e) => setSingleFaculty({ ...singleFaculty, full_name: e.target.value })}
                  placeholder="Dr. John Smith"
                />
              </div>
              <div>
                <Label htmlFor="single-email">Email</Label>
                <Input
                  id="single-email"
                  type="email"
                  value={singleFaculty.email}
                  onChange={(e) => setSingleFaculty({ ...singleFaculty, email: e.target.value })}
                  placeholder="john@college.edu"
                />
              </div>
              <div>
                <Label htmlFor="single-password">Password</Label>
                <Input
                  id="single-password"
                  type="text"
                  value={singleFaculty.password}
                  onChange={(e) => setSingleFaculty({ ...singleFaculty, password: e.target.value })}
                  placeholder="Faculty@123"
                />
              </div>
              <div>
                <Label htmlFor="single-id">Faculty ID</Label>
                <Input
                  id="single-id"
                  value={singleFaculty.faculty_id}
                  onChange={(e) => setSingleFaculty({ ...singleFaculty, faculty_id: e.target.value })}
                  placeholder="FAC001"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="admin" onClick={handleSingleCreate} disabled={creatingOne}>
                {creatingOne ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Create Faculty
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bulk Upload Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Bulk Faculty Registration
          </CardTitle>
          <CardDescription>
            Excel file must have columns: <strong>Name, Email, Password, Faculty ID</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1">
              <Label htmlFor="file-upload" className="sr-only">Upload Excel</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="cursor-pointer"
              />
            </div>
            <Button variant="outline" size="icon" onClick={downloadTemplate} title="Download Template">
              <Download className="w-4 h-4" />
            </Button>
          </div>

          {showPreview && parsedFaculty.length > 0 && (
            <div className="border rounded-lg p-4 bg-muted/50">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-medium">Preview ({parsedFaculty.length} faculty)</h4>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setParsedFaculty([]); setShowPreview(false); }}>
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
                        Create {parsedFaculty.length} Accounts
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
                      <TableHead>Faculty ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedFaculty.slice(0, 10).map((f, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{f.full_name}</TableCell>
                        <TableCell>{f.email}</TableCell>
                        <TableCell className="font-mono text-xs">{f.password}</TableCell>
                        <TableCell>{f.faculty_id}</TableCell>
                      </TableRow>
                    ))}
                    {parsedFaculty.length > 10 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          ... and {parsedFaculty.length - 10} more
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

      {/* Faculty List */}
      <Card>
        <CardHeader>
          <CardTitle>All Faculty</CardTitle>
          <CardDescription>View and manage all registered faculty members</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or faculty ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Faculty ID</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFaculty.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No faculty found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredFaculty.map((f) => {
                    const details = getDetails(f);
                    return (
                      <TableRow key={f.id}>
                        <TableCell className="font-medium">{f.full_name}</TableCell>
                        <TableCell>{f.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{details?.faculty_id || '-'}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(f.created_at).toLocaleDateString()}
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

export default FacultyPage;
