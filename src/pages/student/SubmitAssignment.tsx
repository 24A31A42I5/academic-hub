import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Loader2, Upload, AlertTriangle, ArrowLeft, Clock, FileText, CheckCircle } from 'lucide-react';
import { format, formatDistanceToNow, isPast } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/student', icon: DashboardIcons.Home },
  { label: 'Assignments', href: '/student/assignments', icon: DashboardIcons.BookOpen },
  { label: 'My Submissions', href: '/student/submissions', icon: DashboardIcons.FileText },
  { label: 'My Handwriting', href: '/student/handwriting', icon: DashboardIcons.FileText },
  { label: 'Grades', href: '/student/grades', icon: DashboardIcons.CheckCircle },
];

interface Assignment {
  id: string;
  title: string;
  description: string | null;
  year: number;
  branch: string;
  section: string;
  deadline: string;
  allowed_formats: string[] | null;
}

const SubmitAssignment = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { profile, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [existingSubmission, setExistingSubmission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'student')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile || !assignmentId) return;

      try {
        // Fetch assignment
        const { data: assignmentData, error: assignmentError } = await supabase
          .from('assignments')
          .select('*')
          .eq('id', assignmentId)
          .single();

        if (assignmentError) throw assignmentError;
        setAssignment(assignmentData);

        // Check for existing submission
        const { data: submissionData } = await supabase
          .from('submissions')
          .select('*')
          .eq('assignment_id', assignmentId)
          .eq('student_profile_id', profile.id)
          .maybeSingle();

        setExistingSubmission(submissionData);
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load assignment');
      } finally {
        setLoading(false);
      }
    };

    if (profile?.role === 'student') {
      fetchData();
    }
  }, [profile, assignmentId]);

  const getAcceptedFormats = () => {
    const formats = assignment?.allowed_formats || ['pdf', 'doc', 'docx'];
    const mimeTypes: Record<string, string> = {
      pdf: '.pdf',
      doc: '.doc',
      docx: '.docx',
      image: '.jpg,.jpeg,.png,.webp',
      txt: '.txt',
    };
    return formats.map(f => mimeTypes[f] || `.${f}`).join(',');
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    // Warn about large files that may have verification issues
    if (file.size > 5 * 1024 * 1024) {
      toast.warning(
        'Large file detected. Handwriting verification may require manual review.',
        { duration: 5000 }
      );
    }

    setSelectedFile(file);
  };

  const handleSubmit = async () => {
    if (!selectedFile || !user || !profile || !assignment) return;

    setUploading(true);
    try {
      // Upload file to storage
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${user.id}/${assignment.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('uploads')
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('uploads')
        .getPublicUrl(fileName);

      // Check if deadline passed
      const isLate = isPast(new Date(assignment.deadline));

      // Base submission data (DRY)
      const baseSubmission = {
        file_url: publicUrl,
        file_type: selectedFile.type,
        submitted_at: new Date().toISOString(),
        is_late: isLate,
        status: 'pending',
        ai_similarity_score: null,
        ai_confidence_score: null,
        ai_risk_level: 'pending',
        ai_flagged_sections: null,
        ai_analysis_details: null,
        verified_at: null,
      };

      let submissionId: string;

      // Create or update submission
      if (existingSubmission) {
        const { error } = await supabase
          .from('submissions')
          .update(baseSubmission)
          .eq('id', existingSubmission.id);

        if (error) throw error;
        submissionId = existingSubmission.id;
      } else {
        const { data: newSubmission, error } = await supabase
          .from('submissions')
          .insert({
            ...baseSubmission,
            assignment_id: assignment.id,
            student_profile_id: profile.id,
          })
          .select('id')
          .single();

        if (error) throw error;
        submissionId = newSubmission.id;
      }

      // Trigger AI handwriting verification (non-blocking)
      toast.success('Assignment submitted! AI verification started.');
      
      supabase.functions.invoke('verify-handwriting', {
        body: {
          submission_id: submissionId,
          file_url: publicUrl,
          file_type: selectedFile.type,
          student_profile_id: profile.id,
        },
       }).then(({ error }) => {
         if (error) {
           console.error('Verification error:', error);
           toast.error('Handwriting verification failed. Your submission is saved but may need manual review.');
         } else {
           console.log('Handwriting verification completed');
         }
       }).catch((err) => {
         console.error('Verification failed:', err);
         toast.error('Handwriting verification failed. Your submission is saved but may need manual review.');
       });

      navigate('/student/submissions');
    } catch (error: any) {
      console.error('Error submitting assignment:', error);
      toast.error(error.message || 'Failed to submit assignment. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-student" />
      </div>
    );
  }

  if (!profile || profile.role !== 'student') {
    return null;
  }

  if (!assignment) {
    return (
      <DashboardLayout title="Assignment Not Found" role="student" navItems={navItems}>
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">Assignment not found or you don't have access to it.</p>
            <Link to="/student/assignments">
              <Button variant="outline">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Assignments
              </Button>
            </Link>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  const deadline = new Date(assignment.deadline);
  const isOverdue = isPast(deadline);
  const allowedFormats = assignment.allowed_formats || ['pdf', 'doc', 'docx'];

  return (
    <DashboardLayout title="Submit Assignment" role="student" navItems={navItems}>
      <div className="max-w-2xl mx-auto">
        <Link to="/student/assignments" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Assignments
        </Link>

        {/* Assignment Details */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>{assignment.title}</CardTitle>
                <CardDescription className="mt-1">
                  {assignment.branch} • Year {assignment.year} • Section {assignment.section}
                </CardDescription>
              </div>
              {isOverdue ? (
                <Badge variant="destructive">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Overdue
                </Badge>
              ) : (
                <Badge variant="outline">
                  <Clock className="w-3 h-3 mr-1" />
                  Active
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {assignment.description && (
              <div>
                <p className="text-sm font-medium mb-1">Description</p>
                <p className="text-sm text-muted-foreground">{assignment.description}</p>
              </div>
            )}
            
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span>Due: {format(deadline, 'MMM d, yyyy h:mm a')}</span>
              <span className="text-muted-foreground">
                ({formatDistanceToNow(deadline, { addSuffix: true })})
              </span>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Allowed Formats</p>
              <div className="flex flex-wrap gap-2">
                {allowedFormats.map((f) => (
                  <Badge key={f} variant="secondary">.{f}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Late Submission Warning */}
        {isOverdue && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Late Submission</AlertTitle>
            <AlertDescription>
              The deadline for this assignment has passed. Your submission will be marked as late.
            </AlertDescription>
          </Alert>
        )}

        {/* Reupload Required Warning */}
        {existingSubmission?.verified_at && existingSubmission?.ai_risk_level === 'high' && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Reupload Required</AlertTitle>
            <AlertDescription>
              Your last submission scored below 50 in handwriting verification. Please reupload a clear handwritten file.
            </AlertDescription>
          </Alert>
        )}

        {/* Existing Submission */}
        {existingSubmission && (
          <Alert className="mb-6">
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Previously Submitted</AlertTitle>
            <AlertDescription>
              You have already submitted this assignment on{' '}
              {format(new Date(existingSubmission.submitted_at), 'MMM d, yyyy h:mm a')}.
              Uploading a new file will replace your previous submission.
            </AlertDescription>
          </Alert>
        )}

        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Your Work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              {selectedFile ? (
                <div className="space-y-4">
                  <FileText className="w-12 h-12 text-student mx-auto" />
                  <div>
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    Choose Different File
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg font-medium mb-2">Upload Your File</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Drag and drop or click to browse
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={getAcceptedFormats()}
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  <Button
                    variant="student"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Choose File
                  </Button>
                  <p className="text-xs text-muted-foreground mt-4">
                    Max file size: 10MB. Handwriting will be verified automatically by our AI system.
                  </p>
                </>
              )}
            </div>

            {selectedFile && (
              <Button
                variant="student"
                className="w-full"
                onClick={handleSubmit}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    {existingSubmission ? 'Update Submission' : 'Submit Assignment'}
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default SubmitAssignment;
