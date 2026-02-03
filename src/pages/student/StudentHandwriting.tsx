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
import { Loader2, Upload, AlertTriangle, CheckCircle, Image, FileWarning, Lock, Copy, Sparkles, RefreshCw, Zap } from 'lucide-react';
import { format } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/student', icon: DashboardIcons.Home },
  { label: 'Assignments', href: '/student/assignments', icon: DashboardIcons.BookOpen },
  { label: 'My Submissions', href: '/student/submissions', icon: DashboardIcons.FileText },
  { label: 'My Handwriting', href: '/student/handwriting', icon: DashboardIcons.FileText },
  { label: 'Grades', href: '/student/grades', icon: DashboardIcons.CheckCircle },
];

// Comprehensive sample text for feature extraction
const SAMPLE_TEXT = `ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz
0123456789
The quick brown fox jumps over the lazy dog.
Pack my box with five dozen liquor jugs.`;

const StudentHandwriting = () => {
  const { profile, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [studentDetails, setStudentDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [extractingFeatures, setExtractingFeatures] = useState(false);
  const [retraining, setRetraining] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(SAMPLE_TEXT);
      setCopied(true);
      toast.success('Sample text copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy text');
    }
  };

  // Compute SHA-256 hash of file
  const computeFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Strip EXIF data by re-encoding the image
  const stripExifData = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to process image'));
          }
        }, 'image/jpeg', 0.95);
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

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
      // Compute hash of original file
      const imageHash = await computeFileHash(selectedFile);
      
      // Check if this exact image has been uploaded before
      const { data: existingHash } = await supabase
        .from('student_details')
        .select('id, profile_id')
        .eq('handwriting_image_hash', imageHash)
        .maybeSingle();
      
      if (existingHash && existingHash.profile_id !== profile?.id) {
        toast.error('This image has already been used by another student. Please upload your own handwriting sample.');
        setUploading(false);
        return;
      }

      // Strip EXIF data
      const strippedImage = await stripExifData(selectedFile);
      
      // Upload to storage
      const fileName = `${user.id}/handwriting.jpg`;

      // Use upsert: true to allow re-upload when admin has deleted the old sample
      const { error: uploadError } = await supabase.storage
        .from('handwriting-samples')
        .upload(fileName, strippedImage, {
          cacheControl: '0', // No cache to ensure fresh image
          upsert: true, // Allow overwriting if admin deleted the DB reference but file exists
          contentType: 'image/jpeg',
        });

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('handwriting-samples')
        .getPublicUrl(fileName);

      // Update student_details with handwriting URL and hash
      const { error: updateError } = await supabase
        .from('student_details')
        .update({
          handwriting_url: publicUrl,
          handwriting_submitted_at: new Date().toISOString(),
          handwriting_image_hash: imageHash,
        })
        .eq('id', studentDetails.id);

      if (updateError) throw updateError;

      // Now extract features using the edge function
      setUploading(false);
      setExtractingFeatures(true);

      try {
        const { data: featureData, error: featureError } = await supabase.functions.invoke('extract-handwriting-features', {
          body: {
            image_url: publicUrl,
            student_details_id: studentDetails.id,
          },
        });

        if (featureError) {
          console.error('Feature extraction error:', featureError);
          toast.warning('Image uploaded but feature extraction failed. Your submission will still work.');
        } else if (featureData?.success) {
          toast.success('Handwriting features extracted successfully!');
        }
      } catch (featureErr) {
        console.error('Feature extraction error:', featureErr);
        toast.warning('Image uploaded but feature extraction failed.');
      }

      // Refresh student details
      const { data: updatedDetails } = await supabase
        .from('student_details')
        .select('*')
        .eq('id', studentDetails.id)
        .single();

      setStudentDetails(updatedDetails);
      toast.success('Handwriting sample uploaded successfully');
      setShowConfirmDialog(false);
      setSelectedFile(null);
      setPreviewUrl(null);
    } catch (error: any) {
      console.error('Error uploading handwriting:', error);
      toast.error(error.message || 'Failed to upload handwriting sample');
    } finally {
      setUploading(false);
      setExtractingFeatures(false);
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

  // Retrain/re-extract features from existing handwriting sample
  const handleRetrainFeatures = async () => {
    if (!studentDetails?.handwriting_url || !studentDetails?.id) {
      toast.error('No handwriting sample found');
      return;
    }

    setRetraining(true);
    try {
      const { data, error } = await supabase.functions.invoke('extract-handwriting-features', {
        body: {
          image_url: studentDetails.handwriting_url,
          student_details_id: studentDetails.id,
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('Features re-extracted successfully!');
        // Refresh student details
        const { data: updatedDetails } = await supabase
          .from('student_details')
          .select('*')
          .eq('id', studentDetails.id)
          .single();
        setStudentDetails(updatedDetails);
      } else {
        toast.error(data?.error || 'Feature extraction failed');
      }
    } catch (error: any) {
      console.error('Retrain error:', error);
      toast.error('Failed to re-extract features');
    } finally {
      setRetraining(false);
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
  const hasFeatures = !!studentDetails?.handwriting_feature_embedding;

  return (
    <DashboardLayout title="My Handwriting" role="student" navItems={navItems}>
      {studentDetails && (
        <div className="mb-4 text-sm text-muted-foreground">
          {studentDetails.branch} • Year {studentDetails.year} • Semester {studentDetails.semester} • Section {studentDetails.section}
        </div>
      )}

      <div className="max-w-3xl mx-auto">
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
              Upload a comprehensive handwriting sample for AI-powered verification
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasHandwriting ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-4 bg-student/10 rounded-lg text-student">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Handwriting sample submitted</span>
                  {hasFeatures && (
                    <div className="flex items-center gap-1 ml-auto text-xs bg-student/20 px-2 py-1 rounded-full">
                      <Sparkles className="w-3 h-3" />
                      Features Extracted
                    </div>
                  )}
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <img 
                    src={`${studentDetails.handwriting_url}?t=${studentDetails.handwriting_submitted_at || Date.now()}`} 
                    alt="Your handwriting sample"
                    className="w-full h-auto max-h-96 object-contain bg-muted"
                    key={studentDetails.handwriting_submitted_at}
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

                {/* Retrain Features Button */}
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-start gap-2">
                      <Zap className="w-5 h-5 text-primary mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium text-primary">Train AI Model</p>
                        <p className="text-muted-foreground">
                          {hasFeatures 
                            ? 'Re-extract features if verification results seem incorrect'
                            : 'Extract features from your handwriting for better verification'}
                        </p>
                      </div>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleRetrainFeatures}
                      disabled={retraining}
                      className="shrink-0"
                    >
                      {retraining ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Training...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          {hasFeatures ? 'Retrain' : 'Train Model'}
                        </>
                      )}
                    </Button>
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
              <div className="space-y-6">
                {/* Sample Text to Write */}
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-primary flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      Required Sample Text
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyToClipboard}
                      className="text-xs"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      {copied ? 'Copied!' : 'Copy'}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Write the following text <strong>exactly</strong> on a plain white paper in your natural handwriting:
                  </p>
                  <div className="p-4 bg-background rounded border font-mono text-sm whitespace-pre-wrap leading-relaxed">
                    {SAMPLE_TEXT}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    📝 This comprehensive sample helps the AI extract your unique handwriting features for accurate verification.
                  </p>
                </div>

                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg font-medium mb-2">Upload Your Handwriting Sample</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Take a clear photo of your written sample and upload it
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
                    <li>Write on plain white paper with a black or blue pen</li>
                    <li>Ensure good lighting - no shadows on the paper</li>
                    <li>Write naturally - don't try to make it look perfect</li>
                    <li>Include ALL letters, numbers, and sentences from the sample text</li>
                    <li>Make sure the entire sample is clearly visible in the photo</li>
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
              account and cannot be changed. The AI will extract your unique handwriting features 
              for verification.
              <br /><br />
              Please verify that your sample contains:
              <ul className="list-disc list-inside mt-2 text-sm">
                <li>All capital letters (A-Z)</li>
                <li>All lowercase letters (a-z)</li>
                <li>All numbers (0-9)</li>
                <li>The sample sentences</li>
              </ul>
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
            <Button variant="outline" onClick={handleCancelUpload} disabled={uploading || extractingFeatures}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleUpload} disabled={uploading || extractingFeatures}>
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : extractingFeatures ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Extracting Features...
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