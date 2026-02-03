import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Download, Image, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId?: string | null;
  fileUrl: string | null;
  fileUrls?: string[] | null;
  fileType: string | null;
  studentName?: string;
  assignmentTitle?: string;
}

const FilePreviewDialog = ({
  open,
  onOpenChange,
  submissionId,
  fileUrl,
  fileUrls,
  fileType,
  studentName,
  assignmentTitle,
}: FilePreviewDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const rawRefs = useMemo(() => {
    // Use fileUrls if available, otherwise fall back to single fileUrl
    return fileUrls && fileUrls.length > 0 ? fileUrls : (fileUrl ? [fileUrl] : []);
  }, [fileUrl, fileUrls]);

  const [resolvedUrls, setResolvedUrls] = useState<string[]>([]);
  const allUrls = resolvedUrls.length > 0 ? resolvedUrls : rawRefs;

  const totalPages = allUrls.length;
  const currentUrl = allUrls[currentPage] || null;

  // Resolve to fresh signed URLs when submissionId is provided (uploads bucket is private).
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const run = async () => {
      setError(false);
      setLoading(true);

      // If we don't have a submissionId, just use the raw refs (public URLs / legacy behavior).
      if (!submissionId) {
        setResolvedUrls([]);
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke('resolve-submission-files', {
        body: { submission_id: submissionId },
      });

      if (cancelled) return;

      if (fnError || !data?.success || !Array.isArray(data?.signed_urls) || data.signed_urls.length === 0) {
        // Fall back to raw refs; still allows preview for older rows that stored public URLs.
        console.error('Failed to resolve submission files:', fnError || data);
        setResolvedUrls([]);
        setLoading(false);
        return;
      }

      setResolvedUrls(data.signed_urls);
      setCurrentPage(0);
      setLoading(true);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [open, submissionId]);

  const isImage = !!currentUrl && (
    fileType?.startsWith('image') ||
    !!currentUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)
  );

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
    setCurrentPage(prev => Math.max(0, prev - 1));
  };

  const goToNext = () => {
    setLoading(true);
    setCurrentPage(prev => Math.min(totalPages - 1, prev + 1));
  };

  const getPreviewContent = () => {
    if (!currentUrl) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <AlertCircle className="w-12 h-12 mb-4" />
          <p className="text-lg font-medium">No file to preview</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <AlertCircle className="w-12 h-12 mb-4 text-destructive" />
          <p className="text-lg font-medium">Unable to preview file</p>
          <p className="text-sm mt-2">Please download or open in a new tab</p>
        </div>
      );
    }

    if (isImage) {
      return (
        <div className="relative min-h-[400px] flex items-center justify-center">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-faculty" />
            </div>
          )}
          <img
            src={currentUrl}
            alt={`Page ${currentPage + 1} - Submission by ${studentName}`}
            className="max-w-full max-h-[60vh] object-contain rounded-lg"
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
          <Button variant="faculty" asChild>
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
    // Keep hooks unconditional; only skip rendering when closed.
    !open ? null :
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
        {totalPages > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 px-1">
            {allUrls.map((url, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setLoading(true);
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
            <Button variant="outline" asChild>
              <a href={currentUrl} download>
                <Download className="w-4 h-4 mr-2" />
                Download
              </a>
            </Button>
            <Button variant="faculty" asChild>
              <a href={currentUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in New Tab
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FilePreviewDialog;