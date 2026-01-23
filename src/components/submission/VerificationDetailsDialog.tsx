import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { CheckCircle, XCircle, AlertTriangle, Brain, FileText, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerificationDetails {
  algorithm_version?: string;
  same_writer?: boolean;
  is_handwritten?: boolean;
  confidence_level?: string;
  key_matching_features?: string[];
  key_differences?: string[];
  final_reasoning?: string;
  critical_flags?: string[];
  error_type?: string;
  error?: string;
  reason?: string;
}

interface VerificationDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submission: {
    ai_similarity_score: number | null;
    ai_confidence_score: number | null;
    ai_risk_level: string | null;
    ai_analysis_details: VerificationDetails | null;
    assignment_title?: string;
  };
}

export const VerificationDetailsDialog = ({ 
  open, 
  onOpenChange, 
  submission 
}: VerificationDetailsDialogProps) => {
  const details = submission.ai_analysis_details;
  const score = submission.ai_similarity_score;
  const riskLevel = submission.ai_risk_level;

  const getScoreColor = (score: number | null) => {
    if (score === null) return 'text-muted-foreground';
    if (score >= 70) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProgressColor = (score: number | null) => {
    if (score === null) return '';
    if (score >= 70) return '[&>div]:bg-green-500';
    if (score >= 50) return '[&>div]:bg-yellow-500';
    return '[&>div]:bg-red-500';
  };

  const getRiskBadge = () => {
    switch (riskLevel) {
      case 'low':
        return (
          <Badge className="bg-green-500/10 text-green-600 gap-1">
            <CheckCircle className="w-3 h-3" />
            Verified - Same Writer
          </Badge>
        );
      case 'medium':
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 gap-1">
            <AlertTriangle className="w-3 h-3" />
            Manual Review Required
          </Badge>
        );
      case 'high':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="w-3 h-3" />
            Reupload Required
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <Info className="w-3 h-3" />
            Pending
          </Badge>
        );
    }
  };

  // Handle error states
  if (details?.error_type) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Verification Issue
            </DialogTitle>
            <DialogDescription>
              {submission.assignment_title && `For: ${submission.assignment_title}`}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <p className="text-sm font-medium text-yellow-700">
                {details.reason || details.error || 'Verification could not be completed automatically.'}
              </p>
            </div>
            
            <div className="text-sm text-muted-foreground">
              <p>Your submission has been saved and will be reviewed manually by faculty.</p>
            </div>
            
            {details.error_type === 'no_profile' && (
              <div className="p-3 rounded-lg bg-muted">
                <p className="text-sm">
                  <strong>Action needed:</strong> Please upload your handwriting sample in the "My Handwriting" section.
                </p>
              </div>
            )}
            
            {details.error_type === 'file_too_large' && (
              <div className="p-3 rounded-lg bg-muted">
                <p className="text-sm">
                  <strong>Tip:</strong> For better verification, use image formats (JPG, PNG) instead of PDF, or reduce file size.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            AI Verification Details
          </DialogTitle>
          <DialogDescription>
            {submission.assignment_title && `Analysis for: ${submission.assignment_title}`}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Score Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Similarity Score</span>
              <span className={cn("text-2xl font-bold", getScoreColor(score))}>
                {score !== null ? `${score}%` : 'N/A'}
              </span>
            </div>
            <Progress 
              value={score ?? 0} 
              className={cn("h-3", getProgressColor(score))}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0 - Different Writer</span>
              <span>50 - Uncertain</span>
              <span>100 - Same Writer</span>
            </div>
          </div>

          {/* Status Badge */}
          <div className="flex items-center justify-center">
            {getRiskBadge()}
          </div>

          <Separator />

          {/* Confidence Level */}
          {details?.confidence_level && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <span className="text-sm">Confidence Level</span>
              <Badge variant="outline" className="capitalize">
                {details.confidence_level}
              </Badge>
            </div>
          )}

          {/* Matching Features */}
          {details?.key_matching_features && details.key_matching_features.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-green-600">
                <CheckCircle className="w-4 h-4" />
                Matching Features ({details.key_matching_features.length})
              </div>
              <ul className="space-y-1 pl-6">
                {details.key_matching_features.map((feature, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground list-disc">
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Differences */}
          {details?.key_differences && details.key_differences.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-red-600">
                <XCircle className="w-4 h-4" />
                Key Differences ({details.key_differences.length})
              </div>
              <ul className="space-y-1 pl-6">
                {details.key_differences.map((diff, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground list-disc">
                    {diff}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AI Reasoning */}
          {details?.final_reasoning && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="w-4 h-4" />
                AI Analysis
              </div>
              <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted">
                {details.final_reasoning}
              </p>
            </div>
          )}

          {/* Critical Flags */}
          {details?.critical_flags && details.critical_flags.length > 0 && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2 text-sm font-medium text-red-600 mb-2">
                <AlertTriangle className="w-4 h-4" />
                Critical Flags
              </div>
              <ul className="space-y-1 pl-6">
                {details.critical_flags.map((flag, idx) => (
                  <li key={idx} className="text-sm text-red-600 list-disc">
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Algorithm Version */}
          {details?.algorithm_version && (
            <div className="text-xs text-muted-foreground text-center">
              Algorithm: {details.algorithm_version}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
