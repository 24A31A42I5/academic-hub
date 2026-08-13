import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Upload, AlertTriangle, CheckCircle, Image, FileWarning, Lock, Copy, Sparkles, RefreshCw, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { getHandwritingSignedUrl } from '@/lib/handwritingUrl';

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
  const [signedHandwritingUrl, setSignedHandwritingUrl] = useState<string | null>(null);

  // Refresh signed URL whenever the underlying handwriting_url changes.
  useEffect(() => {
    let cancelled = false;
    const url = studentDetails?.handwriting_url;
    if (!url) {
      setSignedHandwritingUrl(null);
      return;
    }
    (async () => {
      const signed = await getHandwritingSignedUrl(url, 600);
      if (!cancelled) setSignedHandwritingUrl(signed);
    })();
    return () => { cancelled = true; };
  }, [studentDetails?.handwriting_url]);

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

  // Materialize file bytes immediately to keep gallery-selected content stable on mobile browsers.
  const materializeFile = async (file: File): Promise<Blob> => {
    try {
      const buf = await file.arrayBuffer();
      return new Blob([buf], { type: file.type || 'image/jpeg' });
    } catch (e) {
      console.warn('arrayBuffer() failed, falling back to FileReader', e);
      try {
        return await new Promise<Blob>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(new Blob([reader.result as ArrayBuffer], { type: file.type || 'image/jpeg' }));
          reader.onerror = () => reject(new Error(`Could not read "${file.name}" from your device.`));
          reader.readAsArrayBuffer(file);
        });
      } catch (readerError) {
        console.warn('FileReader failed, falling back to object URL fetch', readerError);
        const tempUrl = URL.createObjectURL(file);
        try {
          const response = await fetch(tempUrl);
          if (!response.ok) {
            throw new Error(`Could not access "${file.name}" from your gallery.`);
          }
          const blob = await response.blob();
          return new Blob([blob], { type: blob.type || file.type || 'image/jpeg' });
        } finally {
          URL.revokeObjectURL(tempUrl);
        }
      }
    }
  };

  const decodeBlobToCanvasSource = async (
    blob: Blob,
    fileName: string,
  ): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> => {
    if (typeof createImageBitmap === 'function') {
      try {
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
        } catch {
          bitmap = await createImageBitmap(blob);
        }
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          cleanup: () => bitmap.close?.(),
        };
      } catch (e) {
        console.warn('createImageBitmap failed, falling back to <img>', e);
      }
    }

    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new window.Image();
      img.decoding = 'async';
      img.onload = () => {
        resolve({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          cleanup: () => URL.revokeObjectURL(objectUrl),
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Could not decode "${fileName}". Please select a clearer JPG/PNG image.`));
      };
      img.src = objectUrl;
    });
  };

  // Strip EXIF data by decoding to pixels then re-encoding to JPEG.
  const stripExifData = async (file: File): Promise<Blob> => {
    const stableBlob = await materializeFile(file);
    const { source, width, height, cleanup } = await decodeBlobToCanvasSource(stableBlob, file.name);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Failed to process image on this device');
      }

      ctx.drawImage(source, 0, 0, width, height);

      const outputBlob: Blob | null = await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
      });

      canvas.width = 0;
      canvas.height = 0;

      if (!outputBlob) {
        throw new Error('Failed to process selected image');
      }

      return outputBlob;
    } finally {
      cleanup();
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type (some mobile browsers omit MIME types -> fall back to extension)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/heic', 'image/heif'];
    const hasValidExtension = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
    if (!(file.type ? allowedTypes.includes(file.type) : hasValidExtension)) {
      toast.error('Please upload an image file (JPG, PNG, WebP, HEIC, or HEIF)');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }

    try {
      // Keep a stable in-memory copy so phone gallery handles do not expire.
      const stableBlob = await materializeFile(file);
      const stableFile = new File([stableBlob], file.name || `handwriting-${Date.now()}.jpg`, {
        type: stableBlob.type || file.type || 'image/jpeg',
        lastModified: Date.now(),
      });

      setSelectedFile(stableFile);
      setPreviewUrl(URL.createObjectURL(stableFile));
      setShowConfirmDialog(true);
    } catch (e) {
      console.error('Failed to prepare handwriting image:', e);
      toast.error('Cannot access selected image from gallery. Please choose it again and retry.');
    }
  };


  const handleUpload = async () => {
    if (!selectedFile || !user || !studentDetails) return;

    setUploading(true);
    try {
      // Compute hash of original file
      const imageHash = await computeFileHash(selectedFile);
      
      // Check if this exact image has been uploaded before (limit(1) avoids
      // maybeSingle() throwing when several rows share a hash)
      const { data: existingHashRows } = await supabase
        .from('student_details')
        .select('id, profile_id')
        .eq('handwriting_image_hash', imageHash)
        .limit(1);

      const existingHash = existingHashRows?.[0];
      if (existingHash && existingHash.profile_id !== profile?.id) {
        toast.error('This image has already been used by another student. Please upload your own handwriting sample.');
        setUploading(false);
        return;
      }


      // Strip EXIF data
      const strippedImage = await stripExifData(selectedFile);
      
      // Upload to storage
      const fileName = `${user.id}/handwriting.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('handwriting-samples')
        .upload(fileName, strippedImage, {
          cacheControl: '0',
          upsert: true,
          contentType: 'image/jpeg',
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
        const { data: featureData, error: featureError } = await invokeEdgeFunction('extract-handwriting-features', {
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
      const msg = String(error?.message || '');
      toast.error(
        msg.includes('protected fields')
          ? 'A handwriting sample already exists on your account. Ask your administrator to remove it before uploading a new one.'
          : msg || 'Failed to upload handwriting sample',
      );

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
    if (!studentDetails?.handwriting_url || !studentDetails?.id || studentDetails.profile_id !== profile?.id) {
      toast.error('No handwriting sample found');
      return;
    }

    setRetraining(true);
    try {
      // Build cache-busted URL
      const freshUrl = `${studentDetails.handwriting_url.split('?')[0]}?t=${Date.now()}`;

      // Call edge function which runs with service_role and can clear + re-extract
      const { data, error } = await invokeEdgeFunction('extract-handwriting-features', {
        body: {
          image_url: freshUrl,
          student_details_id: studentDetails.id,
          retrain: true,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Feature extraction failed');

      toast.success('Handwriting model retrained successfully!');

      // Refresh local state
      const { data: updatedDetails } = await supabase
        .from('student_details')
        .select('*')
        .eq('id', studentDetails.id)
        .eq('profile_id', profile!.id)
        .single();

      setStudentDetails(updatedDetails);
    } catch (error: any) {
      console.error('Retrain error:', error);
      toast.error(`Retrain failed: ${error.message}`);
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
  const profileVersion = (studentDetails?.handwriting_feature_embedding as any)?.version;
  const profileNeedsUpdate = hasFeatures && profileVersion && !profileVersion.startsWith('7.');

  return (
    <DashboardLayout title="My Handwriting" role="student" navItems={navItems}>
      {studentDetails && (
        <div className="mb-4 text-sm text-muted-foreground">
          {studentDetails.branch} • Year {studentDetails.year} • Semester {studentDetails.semester} • Section {studentDetails.section}
        </div>
      )}

      <div className="max-w-3xl mx-auto">
        {/* Profile Upgrade Banner */}
        {profileNeedsUpdate && (
          <Alert className="mb-6 border-warning/50 bg-warning/10">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <AlertTitle className="text-warning">System Upgrade: Profile Retrain Required</AlertTitle>
            <AlertDescription className="mt-2 text-muted-foreground">
              Our verification system has been upgraded to v7.0 with improved accuracy and anti-spoofing detection.
              Please retrain your handwriting profile for best results.
              <Button 
                onClick={handleRetrainFeatures} 
                variant="outline" 
                size="sm"
                disabled={retraining}
                className="ml-4"
              >
                {retraining ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Retraining...</>
                ) : (
                  <><RefreshCw className="w-4 h-4 mr-2" />Retrain Now</>
                )}
              </Button>
            </AlertDescription>
          </Alert>
        )}

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
                  {signedHandwritingUrl ? (
                    <img
                      src={signedHandwritingUrl}
                      alt="Handwriting sample preview"
                      className="w-full h-auto max-h-96 object-contain bg-muted"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-48 bg-muted text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading preview…
                    </div>
                  )}
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
                    accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
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