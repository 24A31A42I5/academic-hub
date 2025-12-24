import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Upload, AlertTriangle, CheckCircle, Image, FileWarning, Lock } from 'lucide-react';
import { format } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/student', icon: DashboardIcons.Home },
  { label: 'Assignments', href: '/student/assignments', icon: DashboardIcons.BookOpen },
  { label: 'My Submissions', href: '/student/submissions', icon: DashboardIcons.FileText },
  { label: 'My Handwriting', href: '/student/handwriting', icon: DashboardIcons.FileText },
  { label: 'Grades', href: '/student/grades', icon: DashboardIcons.CheckCircle },
];

const StudentHandwriting = () => {
  const { profile, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [studentDetails, setStudentDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'student')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;

      try {
        const { data: details } = await supabase
          .from('student_details')
          .select('*')
          .eq('profile_id', profile.id)
          .maybeSingle();

        setStudentDetails(details);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.role === 'student') {
      fetchData();
    }
  }, [profile]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Please upload an image file (JPG, PNG, or WebP)');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setShowConfirmDialog(true);
  };

  const handleUpload = async () => {
    if (!selectedFile || !user || !studentDetails) return;

    setUploading(true);
    try {
      // Upload to storage
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${user.id}/handwriting.${fileExt}`;

      const { error: uploadError, data } = await supabase.storage
        .from('handwriting-samples')
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: false, // Prevent overwriting
        });

      if (uploadError) {
        if (uploadError.message.includes('already exists')) {
          toast.error('Handwriting sample already uploaded');
        } else {
          throw uploadError;
        }
        return;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('handwriting-samples')
        .getPublicUrl(fileName);

      // Update student_details with handwriting URL
      const { error: updateError } = await supabase
        .from('student_details')
        .update({
          handwriting_url: publicUrl,
          handwriting_submitted_at: new Date().toISOString(),
        })
        .eq('id', studentDetails.id);

      if (updateError) throw updateError;

      // Refresh student details
      setStudentDetails({
        ...studentDetails,
        handwriting_url: publicUrl,
        handwriting_submitted_at: new Date().toISOString(),
      });

      toast.success('Handwriting sample uploaded successfully');
      setShowConfirmDialog(false);
      setSelectedFile(null);
      setPreviewUrl(null);
    } catch (error: any) {
      console.error('Error uploading handwriting:', error);
      toast.error(error.message || 'Failed to upload handwriting sample');
    } finally {
      setUploading(false);
    }
  };

  const handleCancelUpload = () => {
    setShowConfirmDialog(false);
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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

  const hasHandwriting = !!studentDetails?.handwriting_url;

  return (
    <DashboardLayout title="My Handwriting" role="student" navItems={navItems}>
      {studentDetails && (
        <div className="mb-4 text-sm text-muted-foreground">
          {studentDetails.branch} • Year {studentDetails.year} • Semester {studentDetails.semester} • Section {studentDetails.section}
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Warning Alert */}
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle>Important Notice</AlertTitle>
          <AlertDescription className="mt-2">
            <strong>This is a one-time upload.</strong> Once you submit your handwriting sample, 
            it <strong>cannot be changed or deleted</strong>. Only an administrator can modify 
            your handwriting sample after submission. Please ensure your handwriting sample is 
            clear and represents your actual handwriting.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="w-5 h-5" />
              Handwriting Sample
            </CardTitle>
            <CardDescription>
              Upload a clear image of your handwriting for verification purposes
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasHandwriting ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-4 bg-student/10 rounded-lg text-student">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Handwriting sample submitted</span>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <img 
                    src={studentDetails.handwriting_url} 
                    alt="Your handwriting sample"
                    className="w-full h-auto max-h-96 object-contain bg-muted"
                  />
                </div>

                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    Submitted on: {studentDetails.handwriting_submitted_at 
                      ? format(new Date(studentDetails.handwriting_submitted_at), 'MMM d, yyyy h:mm a')
                      : 'Unknown'}
                  </span>
                  <div className="flex items-center gap-1 text-warning">
                    <Lock className="w-4 h-4" />
                    <span>Locked</span>
                  </div>
                </div>

                <div className="p-4 bg-muted rounded-lg">
                  <div className="flex items-start gap-2">
                    <FileWarning className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="text-sm text-muted-foreground">
                      <p className="font-medium">Need to update your handwriting sample?</p>
                      <p>Contact your administrator to request a change to your handwriting sample.</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg font-medium mb-2">Upload Handwriting Sample</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Drag and drop an image or click to browse
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/jpg,image/webp"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="handwriting-upload"
                  />
                  <Button
                    variant="student"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Choose Image
                  </Button>
                  <p className="text-xs text-muted-foreground mt-4">
                    Accepted formats: JPG, PNG, WebP (max 5MB)
                  </p>
                </div>

                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-2">Tips for a good handwriting sample:</p>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Write at least 3-4 sentences in your natural handwriting</li>
                    <li>Use good lighting to ensure clarity</li>
                    <li>Write on plain white paper for best results</li>
                    <li>Make sure the entire sample is visible in the image</li>
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="w-5 h-5" />
              Confirm Handwriting Submission
            </DialogTitle>
            <DialogDescription className="text-left">
              <strong className="text-destructive">This action cannot be undone!</strong>
              <br /><br />
              Once you submit this handwriting sample, it will be permanently linked to your 
              account and cannot be changed. Only an administrator can modify your handwriting 
              sample after submission.
              <br /><br />
              Are you absolutely sure you want to proceed?
            </DialogDescription>
          </DialogHeader>

          {previewUrl && (
            <div className="border rounded-lg overflow-hidden my-4">
              <img 
                src={previewUrl} 
                alt="Preview"
                className="w-full h-auto max-h-48 object-contain bg-muted"
              />
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleCancelUpload} disabled={uploading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleUpload} disabled={uploading}>
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  I Understand, Submit
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default StudentHandwriting;
