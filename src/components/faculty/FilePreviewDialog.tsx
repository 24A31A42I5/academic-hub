import { useEffect, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Download, Image, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string | null;
  fileUrls?: string[] | null;
  fileType: string | null;
  studentName?: string;
  assignmentTitle?: string;
  submissionId?: string; // Add submission ID for signed URL resolution
}

const FilePreviewDialog = ({
  open,
  onOpenChange,
  fileUrl,
  fileUrls,
  fileType,
  studentName,
  assignmentTitle,
  submissionId,
}: FilePreviewDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [resolvedUrls, setResolvedUrls] = useState<string[]>([]);
  const [resolvingUrls, setResolvingUrls] = useState(false);

  // Resolve signed URLs when dialog opens, with retry for mobile reliability
  const resolveSignedUrls = useCallback(async (retryCount = 0) => {
    if (!submissionId) {
      // If no submissionId, use the provided URLs directly (backwards compat)
      const urls = fileUrls && fileUrls.length > 0 ? fileUrls : (fileUrl ? [fileUrl] : []);
      setResolvedUrls(urls);
      return;
    }

    setResolvingUrls(true);
    try {
      const { data, error } = await supabase.functions.invoke('resolve-submission-files', {
        body: { submission_id: submissionId }
      });

      if (error) {
        console.error('Error resolving URLs:', error);
        // Retry once on failure (helps with mobile network issues)
        if (retryCount < 1) {
          console.log('Retrying signed URL resolution...');
          setTimeout(() => resolveSignedUrls(retryCount + 1), 1500);
          return;
        }
        // Fallback to original URLs after retry exhausted
        const urls = fileUrls && fileUrls.length > 0 ? fileUrls : (fileUrl ? [fileUrl] : []);
        setResolvedUrls(urls);
      } else if (data?.signed_urls && data.signed_urls.length > 0) {
        setResolvedUrls(data.signed_urls);
      } else {
        // Retry once if empty result (mobile timing issue)
        if (retryCount < 1) {
          console.log('Empty result, retrying...');
          setTimeout(() => resolveSignedUrls(retryCount + 1), 1500);
          return;
        }
        const urls = fileUrls && fileUrls.length > 0 ? fileUrls : (fileUrl ? [fileUrl] : []);
        setResolvedUrls(urls);
      }
    } catch (err) {
      console.error('Failed to resolve signed URLs:', err);
      if (retryCount < 1) {
        console.log('Retrying after exception...');
        setTimeout(() => resolveSignedUrls(retryCount + 1), 1500);
        return;
      }
      const urls = fileUrls && fileUrls.length > 0 ? fileUrls : (fileUrl ? [fileUrl] : []);
      setResolvedUrls(urls);
    } finally {
      if (retryCount >= 1 || !submissionId) {
        setResolvingUrls(false);
      }
    }
  }, [submissionId, fileUrls, fileUrl]);

  // Reset state and resolve URLs when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentPage(0);
      setLoading(true);
      setError(false);
      setResolvedUrls([]);
      resolveSignedUrls();
    }
  }, [open, submissionId, resolveSignedUrls]);

  const totalPages = resolvedUrls.length;
  const currentUrl = resolvedUrls[currentPage] || null;

  // Guard against stale page index if the URL list changes.
  useEffect(() => {
    if (currentPage > 0 && currentPage >= totalPages) {
      setCurrentPage(0);
    }
  }, [currentPage, totalPages]);

  if (!open) return null;

  const isImage = fileType?.startsWith('image') || 
    (currentUrl && currentUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i));

  const handleLoad = () => {
    setLoading(false);
    setError(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  const goToPrevious = () => {
    setLoading(true);
    setError(false);
    setCurrentPage(prev => Math.max(0, prev - 1));
  };

  const goToNext = () => {
    setLoading(true);
    setError(false);
    setCurrentPage(prev => Math.min(totalPages - 1, prev + 1));
  };

  const getPreviewContent = () => {
    if (resolvingUrls) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-12 h-12 mb-4 animate-spin text-primary" />
          <p className="text-lg font-medium">Loading files...</p>
        </div>
      );
    }

    if (!currentUrl) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <AlertCircle className="w-12 h-12 mb-4 text-yellow-500" />
          <p className="text-lg font-medium">No files found</p>
          <p className="text-sm mt-2">This submission has no viewable files</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <AlertCircle className="w-12 h-12 mb-4 text-destructive" />
          <p className="text-lg font-medium">Unable to preview file</p>
          <p className="text-sm mt-2">Please download or open in a new tab</p>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" asChild>
              <a href={currentUrl} download>
                <Download className="w-4 h-4 mr-2" />
                Download File
              </a>
            </Button>
            <Button variant="default" asChild>
              <a href={currentUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in New Tab
              </a>
            </Button>
          </div>
        </div>
      );
    }

    if (isImage) {
      return (
        <div className="relative min-h-[400px] flex items-center justify-center">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}
          <img
            src={currentUrl}
            alt={`Page ${currentPage + 1} - Submission by ${studentName}`}
            className={cn(
              "max-w-full max-h-[60vh] object-contain rounded-lg",
              loading && "opacity-0"
            )}
            onLoad={handleLoad}
            onError={handleError}
          />
        </div>
      );
    }

    // For unsupported file types
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Image className="w-16 h-16 mb-4" />
        <p className="text-lg font-medium">Preview not available</p>
        <p className="text-sm mt-2 mb-4">This file type cannot be previewed</p>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href={currentUrl} download>
              <Download className="w-4 h-4 mr-2" />
              Download File
            </a>
          </Button>
          <Button variant="default" asChild>
            <a href={currentUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open in New Tab
            </a>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        setCurrentPage(0);
        setLoading(true);
        setError(false);
        setResolvedUrls([]);
      }
      onOpenChange(isOpen);
    }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image className="w-5 h-5" />
            <span>
              {studentName ? `${studentName}'s Submission` : 'Submission Preview'}
              {assignmentTitle && <span className="text-muted-foreground font-normal"> - {assignmentTitle}</span>}
            </span>
          </DialogTitle>
        </DialogHeader>
        
        {/* Page navigation for multi-page */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 pb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevious}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                Page {currentPage + 1} of {totalPages}
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNext}
              disabled={currentPage === totalPages - 1}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Thumbnail strip for multi-page */}
        {totalPages > 1 && !resolvingUrls && (
          <div className="flex gap-2 overflow-x-auto pb-2 px-1">
            {resolvedUrls.map((url, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setLoading(true);
                  setError(false);
                  setCurrentPage(idx);
                }}
                className={cn(
                  "flex-shrink-0 w-16 h-20 rounded border-2 overflow-hidden transition-all",
                  currentPage === idx 
                    ? "border-primary ring-2 ring-primary/20" 
                    : "border-border hover:border-primary/50"
                )}
              >
                <img
                  src={url}
                  alt={`Page ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
        
        <div className="overflow-auto">
          {getPreviewContent()}
        </div>

        <div className="flex justify-between gap-2 pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {totalPages > 1 && `${totalPages} pages total`}
          </div>
          <div className="flex gap-2">
            {currentUrl && (
              <>
                <Button variant="outline" asChild>
                  <a href={currentUrl} download>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </a>
                </Button>
                <Button variant="default" asChild>
                  <a href={currentUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open in New Tab
                  </a>
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FilePreviewDialog;
