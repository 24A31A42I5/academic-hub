import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Users, GraduationCap } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const navItems = [
  { label: 'Overview', href: '/faculty', icon: DashboardIcons.Home },
  { label: 'My Sections', href: '/faculty/sections', icon: DashboardIcons.FolderOpen },
  { label: 'Assignments', href: '/faculty/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Submissions', href: '/faculty/submissions', icon: DashboardIcons.FileText },
  { label: 'AI Reviews', href: '/faculty/reviews', icon: DashboardIcons.AlertTriangle },
];

interface Section {
  id: string;
  year: number;
  branch: string;
  section: string;
}

interface Student {
  id: string;
  full_name: string;
  email: string;
  roll_number: string;
  has_logged_in: boolean;
}

const FacultySections = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [sections, setSections] = useState<Section[]>([]);
  const [studentsMap, setStudentsMap] = useState<Record<string, Student[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'faculty')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    const fetchSections = async () => {
      if (!profile) return;

      try {
        const { data: sectionsData, error } = await supabase
          .from('faculty_sections')
          .select('id, year, branch, section')
          .eq('faculty_profile_id', profile.id)
          .order('year', { ascending: true });

        if (error) throw error;
        setSections(sectionsData || []);

        // Fetch students for each section
        const studentsPromises = (sectionsData || []).map(async (sec) => {
          const { data } = await supabase
            .from('profiles')
            .select(`
              id,
              full_name,
              email,
              student_details!inner (
                roll_number,
                has_logged_in,
                year,
                branch,
                section
              )
            `)
            .eq('role', 'student')
            .eq('student_details.year', sec.year)
            .eq('student_details.branch', sec.branch)
            .eq('student_details.section', sec.section);

          return {
            key: `${sec.year}-${sec.branch}-${sec.section}`,
            students: (data || []).map((s: any) => ({
              id: s.id,
              full_name: s.full_name,
              email: s.email,
              roll_number: s.student_details?.roll_number || s.student_details?.[0]?.roll_number,
              has_logged_in: s.student_details?.has_logged_in || s.student_details?.[0]?.has_logged_in,
            })),
          };
        });

        const studentsResults = await Promise.all(studentsPromises);
        const map: Record<string, Student[]> = {};
        studentsResults.forEach((r) => {
          map[r.key] = r.students;
        });
        setStudentsMap(map);
      } catch (error) {
        console.error('Error fetching sections:', error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.role === 'faculty') {
      fetchSections();
    }
  }, [profile]);

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
    <DashboardLayout title="My Sections" role="faculty" navItems={navItems}>
      {sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No sections assigned yet</p>
            <p className="text-sm text-muted-foreground mt-2">Contact admin to assign sections</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-full bg-faculty/10">
                  <Users className="w-6 h-6 text-faculty" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{sections.length}</p>
                  <p className="text-sm text-muted-foreground">Sections Assigned</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-full bg-student/10">
                  <GraduationCap className="w-6 h-6 text-student" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {Object.values(studentsMap).reduce((sum, s) => sum + s.length, 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Students</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Accordion type="multiple" className="space-y-4">
            {sections.map((section) => {
              const key = `${section.year}-${section.branch}-${section.section}`;
              const students = studentsMap[key] || [];

              return (
                <AccordionItem key={section.id} value={section.id} className="border rounded-lg px-4">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-4">
                      <Badge variant="outline" className="text-faculty border-faculty">
                        Year {section.year}
                      </Badge>
                      <span className="font-medium">{section.branch} - Section {section.section}</span>
                      <Badge variant="secondary">{students.length} students</Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    {students.length === 0 ? (
                      <p className="text-muted-foreground py-4 text-center">No students in this section</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Roll Number</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {students.map((student) => (
                            <TableRow key={student.id}>
                              <TableCell className="font-mono">{student.roll_number}</TableCell>
                              <TableCell className="font-medium">{student.full_name}</TableCell>
                              <TableCell>{student.email}</TableCell>
                              <TableCell>
                                <Badge variant={student.has_logged_in ? 'default' : 'outline'}>
                                  {student.has_logged_in ? 'Active' : 'Pending'}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      )}
    </DashboardLayout>
  );
};

export default FacultySections;
