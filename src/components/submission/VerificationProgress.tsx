import { useEffect, useState, forwardRef } from 'react';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { 
  Loader2, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Eye,
  FileSearch,
  Brain,
  FileCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerificationProgressProps {
  submissionId: string;
  onComplete?: (status: string, score: number | null) => void;
}

type VerificationStage = 'uploading' | 'fetching' | 'analyzing' | 'comparing' | 'complete';

interface StageInfo {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  progress: number;
}

const STAGES: Record<VerificationStage, StageInfo> = {
  uploading: { label: 'Uploading document...', icon: FileSearch, progress: 15 },
  fetching: { label: 'Fetching handwriting profile...', icon: Eye, progress: 35 },
  analyzing: { label: 'Gemini AI analyzing handwriting features...', icon: Brain, progress: 65 },
  comparing: { label: 'Comparing writing characteristics...', icon: FileCheck, progress: 85 },
  complete: { label: 'Verification complete', icon: CheckCircle, progress: 100 },
};

export const VerificationProgress = forwardRef<HTMLDivElement, VerificationProgressProps>(
  ({ submissionId, onComplete }, ref) => {
    const [stage, setStage] = useState<VerificationStage>('uploading');
    const [status, setStatus] = useState<string | null>(null);
    const [score, setScore] = useState<number | null>(null);
    const [riskLevel, setRiskLevel] = useState<string | null>(null);
    const [isComplete, setIsComplete] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorType, setErrorType] = useState<string | null>(null);

    useEffect(() => {
      // Simulate initial stages with timing
      const stageTimers = [
        setTimeout(() => setStage('fetching'), 1500),
        setTimeout(() => setStage('analyzing'), 3000),
        setTimeout(() => setStage('comparing'), 6000),
      ];

      // Subscribe to realtime updates for this submission
      const channel = supabase
        .channel(`verification-${submissionId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'submissions',
            filter: `id=eq.${submissionId}`,
          },
          (payload) => {
            const newData = payload.new as any;
            
            if (newData.verified_at) {
              setStage('complete');
              setIsComplete(true);
              setStatus(newData.status);
              setScore(newData.ai_similarity_score);
              setRiskLevel(newData.ai_risk_level);
              
              // Check for error types in analysis details
              const analysisDetails = newData.ai_analysis_details;
              if (analysisDetails?.error_type) {
                setErrorType(analysisDetails.error_type);
              }
              
              onComplete?.(newData.status, newData.ai_similarity_score);
            } else if (newData.status === 'verifying') {
              setStage('analyzing');
            }
          }
        )
        .subscribe();

      // Timeout fallback after 60 seconds
      const timeoutTimer = setTimeout(() => {
        if (!isComplete) {
          setError('Verification taking longer than expected. Check your submissions page.');
          setStage('complete');
        }
      }, 60000);

      return () => {
        stageTimers.forEach(clearTimeout);
        clearTimeout(timeoutTimer);
        supabase.removeChannel(channel);
      };
    }, [submissionId, onComplete, isComplete]);

    const currentStage = STAGES[stage];
    const StageIcon = currentStage.icon;

    const getResultBadge = () => {
      if (error) {
        return (
          <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-accent bg-secondary text-secondary-foreground">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Timeout
          </span>
        );
      }

      if (!isComplete || !riskLevel) return null;

      switch (riskLevel) {
        case 'low':
          return (
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-[hsl(142,76%,36%)] border-[hsl(142,76%,36%)] bg-secondary">
              <CheckCircle className="w-3 h-3 mr-1" />
              Verified ({score}%)
            </span>
          );
        case 'medium':
          return (
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-accent-foreground border-accent bg-secondary">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Manual Review ({score}%)
            </span>
          );
        case 'high':
          return (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-destructive text-destructive-foreground">
              <XCircle className="w-3 h-3 mr-1" />
              Reupload Required ({score}%)
            </span>
          );
        default:
          return (
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-border bg-background text-foreground">
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Processing
            </span>
          );
      }
    };

    return (
      <Card ref={ref} className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isComplete ? (
                  <StageIcon className={cn(
                    "w-5 h-5",
                    riskLevel === 'low' ? "text-[hsl(142,76%,36%)]" :
                    riskLevel === 'medium' ? "text-accent-foreground" :
                    riskLevel === 'high' ? "text-destructive" :
                    "text-primary"
                  )} />
                ) : (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                )}
                <span className="font-medium text-sm">
                  {error || currentStage.label}
                </span>
              </div>
              {getResultBadge()}
            </div>

            {/* Progress Bar */}
            <Progress 
              value={currentStage.progress} 
              className={cn(
                "h-2",
                isComplete && riskLevel === 'low' && "[&>div]:bg-[hsl(142,76%,36%)]",
                isComplete && riskLevel === 'medium' && "[&>div]:bg-accent",
                isComplete && riskLevel === 'high' && "[&>div]:bg-destructive"
              )}
            />

            {/* Stage Indicators */}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className={stage !== 'uploading' ? 'text-primary' : ''}>Upload</span>
              <span className={['analyzing', 'comparing', 'complete'].includes(stage) ? 'text-primary' : ''}>
                Fetch Profile
              </span>
              <span className={['comparing', 'complete'].includes(stage) ? 'text-primary' : ''}>
                AI Analysis
              </span>
              <span className={stage === 'complete' ? 'text-primary' : ''}>Complete</span>
            </div>

            {/* Analysis Details */}
            {isComplete && !error && (
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs text-muted-foreground">
                  {riskLevel === 'low' && 'Handwriting verified successfully. Your submission matches your profile.'}
                  {riskLevel === 'medium' && errorType === 'no_profile' && 'No handwriting profile found. Please upload your handwriting sample.'}
                  {riskLevel === 'medium' && errorType === 'file_too_large' && 'File too large for automatic analysis. Try using image format instead of PDF.'}
                  {riskLevel === 'medium' && !errorType && 'Some differences detected. Faculty will review your submission.'}
                  {riskLevel === 'high' && 'Significant differences detected. Please reupload a clear handwritten document.'}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
);

VerificationProgress.displayName = 'VerificationProgress';
