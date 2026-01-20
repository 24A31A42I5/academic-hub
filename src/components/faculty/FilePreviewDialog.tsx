import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink, Download, FileText, Image, Loader2, AlertCircle } from 'lucide-react';

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string | null;
  fileType: string | null;
  studentName?: string;
  assignmentTitle?: string;
}

const FilePreviewDialog = ({
  open,
  onOpenChange,
  fileUrl,
  fileType,
  studentName,
  assignmentTitle,
}: FilePreviewDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (!fileUrl) return null;

  const isImage = fileType?.startsWith('image') || 
    fileUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
  const isPdf = fileType === 'application/pdf' || fileUrl.endsWith('.pdf');
  const isDoc = fileType?.includes('document') || 
    fileUrl.match(/\.(doc|docx)$/i);

  const handleLoad = () => {
    setLoading(false);
    setError(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  const getPreviewContent = () => {
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
            src={fileUrl}
            alt={`Submission by ${studentName}`}
            className="max-w-full max-h-[70vh] object-contain rounded-lg"
            onLoad={handleLoad}
            onError={handleError}
          />
        </div>
      );
    }

    if (isPdf) {
      return (
        <div className="relative min-h-[500px]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
              <Loader2 className="w-8 h-8 animate-spin text-faculty" />
            </div>
          )}
          <iframe
            src={`${fileUrl}#toolbar=1&navpanes=0`}
            className="w-full h-[70vh] rounded-lg border"
            title={`Submission by ${studentName}`}
            onLoad={handleLoad}
            onError={handleError}
          />
        </div>
      );
    }

    // For unsupported file types (Word docs, etc.)
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <FileText className="w-16 h-16 mb-4" />
        <p className="text-lg font-medium">Preview not available</p>
        <p className="text-sm mt-2 mb-4">
          {isDoc ? 'Word documents cannot be previewed in browser' : 'This file type cannot be previewed'}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href={fileUrl} download>
              <Download className="w-4 h-4 mr-2" />
              Download File
            </a>
          </Button>
          <Button variant="faculty" asChild>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open in New Tab
            </a>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isImage ? <Image className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
            <span>
              {studentName ? `${studentName}'s Submission` : 'Submission Preview'}
              {assignmentTitle && <span className="text-muted-foreground font-normal"> - {assignmentTitle}</span>}
            </span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="overflow-auto">
          {getPreviewContent()}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" asChild>
            <a href={fileUrl} download>
              <Download className="w-4 h-4 mr-2" />
              Download
            </a>
          </Button>
          <Button variant="faculty" asChild>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open in New Tab
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FilePreviewDialog;
