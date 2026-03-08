import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { VerificationProgress } from '@/components/submission/VerificationProgress';
import { toast } from 'sonner';
import { Loader2, Upload, AlertTriangle, ArrowLeft, Clock, FileText, CheckCircle, X, Image, GripVertical } from 'lucide-react';
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

interface SelectedImage {
  file: File;
  preview: string;
  id: string;
}

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image
const MAX_IMAGES = 20;

const SubmitAssignment = () => {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { profile, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [existingSubmission, setExistingSubmission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [verifyingSubmissionId, setVerifyingSubmissionId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

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

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      selectedImages.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, []);

  const validateImageFile = (file: File): string | null => {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    const isValidType = ACCEPTED_IMAGE_TYPES.includes(file.type) || ['jpg', 'jpeg', 'png', 'webp'].includes(ext);

    if (!isValidType) {
      return `"${file.name}" is not a supported image format. Use JPG, PNG, or WEBP.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `"${file.name}" exceeds 10MB. Please compress it before uploading.`;
    }
    return null;
  };

  const normalizeImageFile = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const imgEl = new window.Image();

      imgEl.onload = () => {
        URL.revokeObjectURL(objectUrl);

        let { naturalWidth: w, naturalHeight: h } = imgEl;

        if (w > 1920 || h > 1920) {
          if (w >= h) {
            h = Math.round(h * (1920 / w));
            w = 1920;
          } else {
            w = Math.round(w * (1920 / h));
            h = 1920;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }

        ctx.drawImage(imgEl, 0, 0, w, h);

        canvas.toBlob(
          (blob) => {
            canvas.width = 0;
            canvas.height = 0;
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob returned null'));
          },
          'image/jpeg',
          0.85
        );
      };

      imgEl.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Image failed to load — file may be corrupted'));
      };

      imgEl.src = objectUrl;
    });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newImages: SelectedImage[] = [];
    const errors: string[] = [];

    // Check total count
    if (selectedImages.length + files.length > MAX_IMAGES) {
      toast.error(`Maximum ${MAX_IMAGES} images allowed per submission.`);
      return;
    }

    Array.from(files).forEach(file => {
      const error = validateImageFile(file);
      if (error) {
        errors.push(error);
      } else {
        newImages.push({
          file,
          preview: URL.createObjectURL(file),
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        });
      }
    });

    if (errors.length > 0) {
      errors.forEach(err => toast.error(err));
    }

    if (newImages.length > 0) {
      setSelectedImages(prev => [...prev, ...newImages]);
      setPageCount(prev => prev + newImages.length);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (id: string) => {
    setSelectedImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img) {
        URL.revokeObjectURL(img.preview);
      }
      return prev.filter(i => i.id !== id);
    });
    setPageCount(prev => prev - 1);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newImages = [...selectedImages];
    const [draggedItem] = newImages.splice(draggedIndex, 1);
    newImages.splice(index, 0, draggedItem);
    setSelectedImages(newImages);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleSubmit = async () => {
    if (selectedImages.length === 0 || !user || !profile || !assignment) return;

    setUploading(true);
    try {
      const uploadedUrls: string[] = [];
      const timestamp = Date.now();

      // Upload all images in order (normalized)
      for (let i = 0; i < selectedImages.length; i++) {
        const img = selectedImages[i];
        const fileName = `${user.id}/${assignment.id}/page_${i + 1}_${timestamp}.jpg`;

        // Normalize image for mobile compatibility
        const normalizedBlob = await normalizeImageFile(img.file);

        const { error: uploadError } = await supabase.storage
          .from('uploads')
          .upload(fileName, normalizedBlob, {
            contentType: 'image/jpeg',
            cacheControl: 'no-cache',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        // Store the storage path (not public URL) for private bucket
        uploadedUrls.push(fileName);
      }

      // Check if deadline passed
      const isLate = isPast(new Date(assignment.deadline));

      // Base submission data — only include fields students are allowed to modify
      const studentSubmissionData = {
        file_url: uploadedUrls[0], // First image for backward compatibility
        file_urls: uploadedUrls,
        file_type: 'image/jpeg',
        submitted_at: new Date().toISOString(),
        is_late: isLate,
      };

      // Full submission data for new inserts (includes AI fields with defaults)
      const newSubmissionData = {
        ...studentSubmissionData,
        status: 'pending',
        ai_risk_level: 'pending',
      };

      let submissionId: string;

      // Create or update submission
      if (existingSubmission) {
        // Fix 10: Chain .select('id') to detect RLS rejection
        const { data: updatedRows, error } = await supabase
          .from('submissions')
          .update(studentSubmissionData)
          .eq('id', existingSubmission.id)
          .select('id');

        if (error) throw error;
        if (!updatedRows || updatedRows.length === 0) {
          throw new Error('Submission update was blocked — this assignment may already be graded.');
        }
        submissionId = existingSubmission.id;
      } else {
        const { data: newSubmission, error } = await supabase
          .from('submissions')
          .insert({
            ...newSubmissionData,
            assignment_id: assignment.id,
            student_profile_id: profile.id,
          })
          .select('id')
          .single();

        if (error) throw error;
        submissionId = newSubmission.id;
      }

      // Show verification progress
      setVerifyingSubmissionId(submissionId);
      setShowProgress(true);
      toast.success(`${uploadedUrls.length} page(s) submitted! AI verification started.`);
      
      // Trigger AI handwriting verification with all image URLs
      supabase.functions.invoke('verify-handwriting', {
        body: {
          submission_id: submissionId,
          file_urls: uploadedUrls,
          file_type: 'image/jpeg',
          student_profile_id: profile.id,
          page_count: uploadedUrls.length,
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

  return (
    <DashboardLayout title="Submit Assignment" role="student" navItems={navItems}>
      <div className="max-w-3xl mx-auto">
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
              <p className="text-sm font-medium mb-2">Accepted Formats</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">.jpg</Badge>
                <Badge variant="secondary">.png</Badge>
                <Badge variant="secondary">.webp</Badge>
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
              Your last submission scored below 50 in handwriting verification. Please reupload clear handwritten images.
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
              Uploading new images will replace your previous submission.
            </AlertDescription>
          </Alert>
        )}

        {/* Verification Progress */}
        {showProgress && verifyingSubmissionId && (
          <div className="mb-6">
            <VerificationProgress 
              submissionId={verifyingSubmissionId}
              pageCount={pageCount}
              onComplete={(status, score) => {
                console.log('Verification complete:', status, score);
                if (status === 'verified') {
                  toast.success('Handwriting verified successfully!');
                } else if (status === 'needs_manual_review') {
                  toast.info('Submission sent for manual review.');
                } else {
                  toast.warning('Please check your submission status.');
                }
                setTimeout(() => navigate('/student/submissions'), 2500);
              }}
            />
          </div>
        )}

        {/* Upload Section */}
        <Card className={showProgress ? 'opacity-50 pointer-events-none' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="w-5 h-5" />
              Upload Handwritten Pages
            </CardTitle>
            <CardDescription>
              Upload images of your handwritten assignment (one image per page). 
              Drag to reorder pages if needed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Image Grid */}
            {selectedImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {selectedImages.map((img, index) => (
                  <div
                    key={img.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`relative group border rounded-lg overflow-hidden bg-muted aspect-[3/4] cursor-move ${
                      draggedIndex === index ? 'opacity-50 ring-2 ring-primary' : ''
                    }`}
                  >
                    <img
                      src={img.preview}
                      alt={`Page ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => removeImage(img.id)}
                        className="h-8"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="absolute top-1 left-1 flex items-center gap-1">
                      <Badge variant="secondary" className="text-xs py-0">
                        Page {index + 1}
                      </Badge>
                    </div>
                    <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="w-4 h-4 text-white" />
                    </div>
                  </div>
                ))}
                
                {/* Add More Button */}
                {selectedImages.length < MAX_IMAGES && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed rounded-lg aspect-[3/4] flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    <Upload className="w-8 h-8 mb-2" />
                    <span className="text-xs">Add Page</span>
                  </button>
                )}
              </div>
            )}

            {/* Initial Upload Area */}
            {selectedImages.length === 0 && (
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Image className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-medium mb-2">Upload Handwritten Assignment Images</p>
                <p className="text-sm text-muted-foreground mb-1">
                  One image per handwritten page
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  Supported formats: JPG, PNG, WEBP (max 10MB each)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />
                <Button
                  variant="student"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Choose Images
                </Button>
                <p className="text-xs text-muted-foreground mt-4">
                  Handwriting will be verified automatically by AI on each page.
                </p>
              </div>
            )}

            {/* Hidden file input for adding more (only rendered when images exist, avoids duplicate) */}
            {selectedImages.length > 0 && (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            )}

            {/* Submit Button */}
            {selectedImages.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground text-center">
                  {selectedImages.length} page{selectedImages.length > 1 ? 's' : ''} ready to submit
                </p>
                <Button
                  variant="student"
                  className="w-full"
                  onClick={handleSubmit}
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Uploading {selectedImages.length} page(s)...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      {existingSubmission ? 'Update Submission' : 'Submit Assignment'}
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default SubmitAssignment;
