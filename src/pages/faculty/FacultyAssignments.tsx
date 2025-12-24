import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, BookOpen, Plus, FileText, AlertTriangle, Calendar, Pencil, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

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

interface Assignment {
  id: string;
  title: string;
  description: string | null;
  year: number;
  branch: string;
  section: string;
  semester?: string;
  deadline: string;
  allowed_formats: string[] | null;
  created_at: string;
  submissions: { id: string; status: string; ai_risk_level: string }[];
}

const FacultyAssignments = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  
  const [form, setForm] = useState({
    title: '',
    description: '',
    sectionId: '',
    deadline: '',
    formats: ['pdf', 'doc', 'docx'],
  });

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'faculty')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  const fetchData = async () => {
    if (!profile) return;

    try {
      const [assignmentsRes, sectionsRes] = await Promise.all([
        supabase
          .from('assignments')
          .select('*, submissions(id, status, ai_risk_level)')
          .eq('faculty_profile_id', profile.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('faculty_sections')
          .select('id, year, branch, section')
          .eq('faculty_profile_id', profile.id),
      ]);

      if (assignmentsRes.error) throw assignmentsRes.error;
      if (sectionsRes.error) throw sectionsRes.error;

      setAssignments(assignmentsRes.data || []);
      setSections(sectionsRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.role === 'faculty') {
      fetchData();
    }
  }, [profile]);

  const handleCreate = async () => {
    if (!form.title || !form.sectionId || !form.deadline) {
      toast.error('Please fill all required fields');
      return;
    }

    const selectedSection = sections.find((s) => s.id === form.sectionId);
    if (!selectedSection) return;

    setCreating(true);
    try {
      const { error } = await supabase.from('assignments').insert({
        title: form.title,
        description: form.description || null,
        year: selectedSection.year,
        branch: selectedSection.branch,
        section: selectedSection.section,
        deadline: new Date(form.deadline).toISOString(),
        allowed_formats: form.formats,
        faculty_profile_id: profile!.id,
      });

      if (error) throw error;

      toast.success('Assignment created successfully');
      setShowCreate(false);
      setForm({ title: '', description: '', sectionId: '', deadline: '', formats: ['pdf', 'doc', 'docx'] });
      fetchData();
    } catch (error) {
      console.error('Error creating assignment:', error);
      toast.error('Failed to create assignment');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('assignments').delete().eq('id', id);
      if (error) throw error;
      toast.success('Assignment deleted');
      fetchData();
    } catch (error) {
      console.error('Error deleting assignment:', error);
      toast.error('Failed to delete assignment');
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
    <DashboardLayout title="Assignments" role="faculty" navItems={navItems}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <p className="text-muted-foreground">Manage your assignments and track submissions</p>
        </div>
        <Button variant="faculty" onClick={() => setShowCreate(true)} disabled={sections.length === 0}>
          <Plus className="w-4 h-4 mr-2" />
          Create Assignment
        </Button>
      </div>

      {sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No sections assigned</p>
            <p className="text-sm text-muted-foreground mt-2">You need sections assigned to create assignments</p>
          </CardContent>
        </Card>
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">No assignments created yet</p>
            <Button variant="faculty" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Assignment
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {assignments.map((assignment) => {
            const submissionCount = assignment.submissions?.length || 0;
            const flaggedCount = assignment.submissions?.filter(
              (s) => ['high', 'medium'].includes(s.ai_risk_level)
            ).length || 0;
            const isActive = new Date(assignment.deadline) > new Date();

            return (
              <Card key={assignment.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold">{assignment.title}</h3>
                        <Badge variant={isActive ? 'default' : 'secondary'}>
                          {isActive ? 'Active' : 'Closed'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">
                        {assignment.description || 'No description provided'}
                      </p>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <Badge variant="outline">
                          Year {assignment.year} - Sem {assignment.semester || 'I'} - {assignment.branch} - Section {assignment.section}
                        </Badge>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Calendar className="w-4 h-4" />
                          Due: {format(new Date(assignment.deadline), 'MMM d, yyyy h:mm a')}
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <FileText className="w-4 h-4" />
                          {submissionCount} submissions
                        </span>
                        {flaggedCount > 0 && (
                          <span className="flex items-center gap-1 text-warning">
                            <AlertTriangle className="w-4 h-4" />
                            {flaggedCount} flagged
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link to={`/faculty/submissions?assignment=${assignment.id}`}>
                        <Button variant="outline" size="sm">
                          <FileText className="w-4 h-4 mr-1" />
                          View Submissions
                        </Button>
                      </Link>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Assignment</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete this assignment and all its submissions.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(assignment.id)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Assignment Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Assignment title"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Assignment description and instructions"
                rows={3}
              />
            </div>
            <div>
              <Label>Section *</Label>
              <Select value={form.sectionId} onValueChange={(v) => setForm({ ...form, sectionId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((sec) => (
                    <SelectItem key={sec.id} value={sec.id}>
                      Year {sec.year} - {sec.branch} - Section {sec.section}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Deadline *</Label>
              <Input
                type="datetime-local"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button variant="faculty" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default FacultyAssignments;
