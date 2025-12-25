import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Loader2, Users, Link2, Trash2, Plus } from 'lucide-react';
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

interface FacultyProfile {
  id: string;
  full_name: string;
  email: string;
}

interface FacultySection {
  id: string;
  faculty_profile_id: string;
  year: number;
  branch: string;
  section: string;
  semester: string;
  created_at: string;
  profiles: FacultyProfile | null;
}

const SectionMappingPage = () => {
  const { profile, loading: authLoading } = useAuth();
  const [mappings, setMappings] = useState<FacultySection[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // New mapping form
  const [selectedFaculty, setSelectedFaculty] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  
  // Filters
  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch faculty list
      const { data: faculty, error: facultyError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'faculty')
        .order('full_name');

      if (facultyError) throw facultyError;
      setFacultyList(faculty || []);

      // Fetch existing mappings
      const { data: sections, error: sectionsError } = await supabase
        .from('faculty_sections')
        .select(`
          id,
          faculty_profile_id,
          year,
          branch,
          section,
          semester,
          created_at,
          profiles:faculty_profile_id (
            id,
            full_name,
            email
          )
        `)
        .order('year')
        .order('branch')
        .order('section');

      if (sectionsError) throw sectionsError;
      setMappings((sections as unknown as FacultySection[]) || []);
    } catch (error) {
      logger.error('Error fetching data', error);
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.role === 'admin') {
      fetchData();
    }
  }, [profile, fetchData]);

  const handleAddMapping = async () => {
    if (!selectedFaculty || !selectedYear || !selectedBranch || !selectedSection || !selectedSemester) {
      toast.error('Please fill all fields');
      return;
    }

    // Check if mapping already exists
    const exists = mappings.some(
      m => m.faculty_profile_id === selectedFaculty &&
           m.year === parseInt(selectedYear) &&
           m.branch === selectedBranch &&
           m.section === selectedSection &&
           m.semester === selectedSemester
    );

    if (exists) {
      toast.error('This mapping already exists');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('faculty_sections')
        .insert({
          faculty_profile_id: selectedFaculty,
          year: parseInt(selectedYear),
          branch: selectedBranch,
          section: selectedSection,
          semester: selectedSemester,
        });

      if (error) throw error;

      toast.success('Section mapping added');
      setSelectedFaculty('');
      setSelectedYear('');
      setSelectedBranch('');
      setSelectedSection('');
      setSelectedSemester('');
      fetchData();
    } catch (error) {
      logger.error('Error adding mapping', error);
      toast.error('Failed to add mapping');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMapping = async (id: string) => {
    setDeleting(id);
    try {
      const { error } = await supabase
        .from('faculty_sections')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Mapping deleted');
      fetchData();
    } catch (error) {
      logger.error('Error deleting mapping', error);
      toast.error('Failed to delete mapping');
    } finally {
      setDeleting(null);
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

  // Filter mappings
  const filteredMappings = mappings.filter((m) => {
    const matchesYear = filterYear === 'all' || m.year.toString() === filterYear;
    const matchesBranch = filterBranch === 'all' || m.branch === filterBranch;
    const matchesSection = filterSection === 'all' || m.section === filterSection;
    const matchesSemester = filterSemester === 'all' || m.semester === filterSemester;
    return matchesYear && matchesBranch && matchesSection && matchesSemester;
  });

  return (
    <DashboardLayout title="Section Mapping" role="admin" navItems={navItems}>
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-faculty/10">
              <Users className="w-6 h-6 text-faculty" />
            </div>
            <div>
              <p className="text-2xl font-bold">{facultyList.length}</p>
              <p className="text-sm text-muted-foreground">Total Faculty</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-primary/10">
              <Link2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{mappings.length}</p>
              <p className="text-sm text-muted-foreground">Section Assignments</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add New Mapping */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Assign Faculty to Section
          </CardTitle>
          <CardDescription>
            Map a faculty member to a specific year, branch, and section
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <Label>Faculty</Label>
              <Select value={selectedFaculty} onValueChange={setSelectedFaculty}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Faculty" />
                </SelectTrigger>
                <SelectContent>
                  {facultyList.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Year</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      Year {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Branch</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Branch" />
                </SelectTrigger>
                <SelectContent>
                  {BRANCHES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Section</Label>
              <Select value={selectedSection} onValueChange={setSelectedSection}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Section" />
                </SelectTrigger>
                <SelectContent>
                  {SECTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      Section {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Semester</Label>
              <Select value={selectedSemester} onValueChange={setSelectedSemester}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Semester" />
                </SelectTrigger>
                <SelectContent>
                  {SEMESTERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      Sem {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleAddMapping} disabled={saving} className="w-full">
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Add Mapping
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Existing Mappings */}
      <Card>
        <CardHeader>
          <CardTitle>Current Mappings</CardTitle>
          <CardDescription>View and manage faculty-section assignments</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-4">
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
          </div>
          
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Faculty</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Semester</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMappings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No mappings found. Add a faculty-section assignment above.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMappings.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.profiles?.full_name || '-'}</TableCell>
                      <TableCell>{m.profiles?.email || '-'}</TableCell>
                      <TableCell><Badge variant="outline">Year {m.year}</Badge></TableCell>
                      <TableCell><Badge variant="outline">Sem {m.semester || 'I'}</Badge></TableCell>
                      <TableCell><Badge>{m.branch}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{m.section}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(m.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove Mapping</AlertDialogTitle>
                            <AlertDialogDescription>
                                Remove {m.profiles?.full_name} from Year {m.year} Sem {m.semester || 'I'} {m.branch} Section {m.section}?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteMapping(m.id)} disabled={deleting === m.id}>
                                {deleting === m.id ? 'Removing...' : 'Remove'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default SectionMappingPage;
