import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { DocumentCapture } from '@/components/DocumentCapture';
import { normalizeImageFile } from '@/lib/imageProcessing';

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

// Image format/size rules are enforced by @/lib/imageProcessing.

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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [verificationReady, setVerificationReady] = useState(false);
  const [verificationScore, setVerificationScore] = useState<number | null>(null);

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

  // Image validation, HEIC conversion, EXIF-aware decoding, downscaling and
  // JPEG encoding all live in the shared mobile-safe pipeline.


  const handleCapture = (file: File) => {
    const newImages: SelectedImage[] = [];
    if (selectedImages.length >= MAX_IMAGES) {
      toast.error(`Maximum ${MAX_IMAGES} images allowed per submission.`);
      return;
    }
    newImages.push({ file, preview: URL.createObjectURL(file), id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}` });
    setSelectedImages(prev => [...prev, ...newImages]);
    setPageCount(prev => prev + 1);
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
      const timestamp = Date.now();

      // Normalize + upload pages with bounded concurrency so multi-page
      // submissions (especially from phones) finish much faster, while keeping
      // memory use safe on low-end devices. Page order is preserved.
      const UPLOAD_CONCURRENCY = 2;
      const uploadedUrls: string[] = new Array(selectedImages.length);

      const uploadOne = async (index: number) => {
        const img = selectedImages[index];
        const fileName = `${user.id}/${assignment.id}/page_${index + 1}_${timestamp}.jpg`;

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
        uploadedUrls[index] = fileName;
      };

      for (let start = 0; start < selectedImages.length; start += UPLOAD_CONCURRENCY) {
        const batch = Array.from(
          { length: Math.min(UPLOAD_CONCURRENCY, selectedImages.length - start) },
          (_, offset) => start + offset
        );
        await Promise.all(batch.map(uploadOne));
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

      // The row is a draft until the student confirms the AI result.
      setVerifyingSubmissionId(submissionId);
      setShowProgress(true);
      setVerificationReady(false);
      setVerificationScore(null);
      toast.success(`${uploadedUrls.length} page(s) captured. AI consistency review started.`);
      
      // Trigger AI handwriting verification with all image URLs
      // (session freshness + 401 retry handled by invokeEdgeFunction)
      const { error: verificationError } = await invokeEdgeFunction('verify-handwriting', {
        body: {
          submission_id: submissionId,
        },
      });
      if (verificationError) {
        console.error('Verification error:', verificationError);
        toast.error(verificationError.name === 'SessionExpiredError' ? 'Your session expired. Please sign in again.' : 'AI consistency review failed. Recapture the affected pages.');
      }

    } catch (error: any) {
      console.error('Error submitting assignment:', error);
      toast.error(error.message || 'Failed to submit assignment. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleFinalSubmit = async () => {
    if (!verifyingSubmissionId || verificationScore === null) return;
    setUploading(true);
    try {
      const { error } = await invokeEdgeFunction('finalize-submission', { body: { submission_id: verifyingSubmissionId } });
      if (error) throw error;
      toast.success('Assignment submitted with its AI-assisted consistency result.');
      navigate('/student/submissions');
    } catch (error: any) {
      toast.error(error.message || 'Could not finalize the submission.');
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

        {/* Previous low-consistency warning */}
        {existingSubmission?.verified_at && existingSubmission?.ai_risk_level === 'high' && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Low consistency result</AlertTitle>
            <AlertDescription>
              Your last submission had low handwriting consistency. Recapture clear handwritten pages or request manual review.
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
                setVerificationScore(typeof score === 'number' ? score : null);
                const hasUsableResult = typeof score === 'number' && Number.isFinite(score);
                setVerificationReady(hasUsableResult);
                if (hasUsableResult) toast.success(`Consistency review complete: ${score}%`);
                else toast.warning('No consistency score was produced. Recapture the page or request manual review.');
              }}
            />
          </div>
        )}

        {verificationReady && verificationScore !== null && (
          <Alert className="mb-6 border-student/40 bg-student/5">
            <CheckCircle className="h-4 w-4 text-student" />
            <AlertTitle>AI-assisted consistency review complete</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>Aggregate score: <strong>{verificationScore}%</strong> ({verificationScore >= 80 ? 'High consistency' : verificationScore >= 60 ? 'Medium consistency - manual review' : 'Low consistency - recapture or manual review'})</span>
              <Button onClick={handleFinalSubmit} disabled={uploading} variant="student">
                {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                Final Submit
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Upload Section */}
        <Card className={showProgress ? 'opacity-50 pointer-events-none' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="w-5 h-5" />
              Capture Handwritten Pages
            </CardTitle>
            <CardDescription>
              Capture each handwritten page with the mobile camera. AI reviews every page against your enrollment samples before final submission.
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
                        aria-label={`Remove page ${index + 1}`}
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
                
              </div>
            )}

            <DocumentCapture pageNumber={selectedImages.length + 1} onCapture={handleCapture} disabled={uploading || selectedImages.length >= MAX_IMAGES} />

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
                  disabled={uploading || showProgress || verificationReady}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Preparing {selectedImages.length} page(s)...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Review Captured Pages
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
