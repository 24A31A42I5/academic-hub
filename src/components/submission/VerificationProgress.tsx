import { useEffect, useState, forwardRef, useCallback } from 'react';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { 
  Loader2, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Eye,
  FileSearch,
  Brain,
  FileCheck,
  Image
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Database } from '@/integrations/supabase/types';

interface VerificationProgressProps {
  submissionId: string;
  pageCount?: number;
  onComplete?: (status: string, score: number | null) => void;
}

type VerificationStage = 'uploading' | 'fetching' | 'analyzing' | 'comparing' | 'complete';

interface StageInfo {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  progress: number;
}

/**
 * Represents the verification result for a single page of a submission
 * @property same_writer - Whether the page was written by the same author as the reference
 * @property confidence - Confidence score as a percentage (0-100)
 */
interface PageResult {
  same_writer: boolean;
  confidence: number;
}

type SubmissionRow = Database['public']['Tables']['submissions']['Row'];

export const VerificationProgress = forwardRef<HTMLDivElement, VerificationProgressProps>(
  ({ submissionId, pageCount = 1, onComplete }, ref) => {
    const [stage, setStage] = useState<VerificationStage>('uploading');
    const [currentPage, setCurrentPage] = useState(1);
    const [status, setStatus] = useState<string | null>(null);
    const [score, setScore] = useState<number | null>(null);
    const [riskLevel, setRiskLevel] = useState<string | null>(null);
    const [isComplete, setIsComplete] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorType, setErrorType] = useState<string | null>(null);
    const [pageResults, setPageResults] = useState<PageResult[]>([]);

    const applyBackendCompletionState = useCallback((row: SubmissionRow) => {
      if (!row?.verified_at) return;

      setStage('complete');
      setIsComplete(true);
      setStatus(row.status);
      setScore(row.ai_similarity_score);
      setRiskLevel(row.ai_risk_level);

      if (row.page_verification_results) {
        setPageResults(row.page_verification_results as PageResult[]);
      } else if (row.ai_analysis_details && typeof row.ai_analysis_details === 'object' && row.ai_analysis_details !== null && 'page_results' in row.ai_analysis_details) {
        const details = row.ai_analysis_details as { page_results: PageResult[] };
        setPageResults(details.page_results);
      }

      const analysisDetails = row.ai_analysis_details as Record<string, unknown> | null;
      if (analysisDetails && typeof analysisDetails.error_type === 'string') {
        setErrorType(analysisDetails.error_type);
      }

      onComplete?.(row.status, row.ai_similarity_score);
    }, [onComplete]);

    const getStageLabel = (): string => {
      switch (stage) {
        case 'uploading':
          return 'Uploading images...';
        case 'fetching':
          return 'Fetching handwriting profile...';
        case 'analyzing':
          return pageCount > 1 
            ? `Analyzing page ${currentPage} of ${pageCount}...`
            : 'Gemini AI analyzing handwriting features...';
        case 'comparing':
          return pageCount > 1
            ? 'Aggregating page results...'
            : 'Comparing writing characteristics...';
        case 'complete':
          return 'Verification complete';
        default:
          return 'Processing...';
      }
    };

    const getProgress = (): number => {
      switch (stage) {
        case 'uploading':
          return 15;
        case 'fetching':
          return 30;
        case 'analyzing':
          if (pageCount > 1) {
            // Progress through pages: 30-80% range
            return 30 + (currentPage / pageCount) * 50;
          }
          return 60;
        case 'comparing':
          return 90;
        case 'complete':
          return 100;
        default:
          return 0;
      }
    };

    useEffect(() => {
      let cancelled = false;

      // Simulate initial stages with timing
      const stageTimers = [
        setTimeout(() => setStage('fetching'), 1500),
        setTimeout(() => setStage('analyzing'), 3000),
      ];

      // If realtime is missed (e.g., verification completes very quickly), fetch once on mount.
      (async () => {
        const { data } = await supabase
          .from('submissions')
          .select('verified_at,status,ai_similarity_score,ai_risk_level,ai_analysis_details,page_verification_results')
          .eq('id', submissionId)
          .maybeSingle();

        if (!cancelled) {
          applyBackendCompletionState(data);
        }
      })();

      // Simulate page progression for multi-page submissions
      if (pageCount > 1) {
        for (let i = 1; i <= pageCount; i++) {
          stageTimers.push(
            setTimeout(() => {
              if (!isComplete) {
                setCurrentPage(i);
              }
            }, 3000 + (i * 2000))
          );
        }
        stageTimers.push(
          setTimeout(() => {
            if (!isComplete) {
              setStage('comparing');
            }
          }, 3000 + (pageCount * 2000) + 1000)
        );
      } else {
        stageTimers.push(setTimeout(() => {
          if (!isComplete) {
            setStage('comparing');
          }
        }, 6000));
      }

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
            const newData = payload.new as SubmissionRow;
            
            if (newData.verified_at) {
              applyBackendCompletionState(newData);
            } else if (newData.status === 'verifying') {
              setStage('analyzing');
            }
          }
        )
        .subscribe();

      // Timeout fallback after 180 seconds (3 minutes for multi-page)
      // Only show timeout if verification hasn't completed via realtime
      const timeoutTimer = setTimeout(() => {
        // UI-only sync: if realtime missed the completion event, fetch the current row
        // before showing any "timeout"-like state.
        if (isComplete) return;
        supabase
          .from('submissions')
          .select('verified_at,status,ai_similarity_score,ai_risk_level,ai_analysis_details,page_verification_results')
          .eq('id', submissionId)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.verified_at) {
              applyBackendCompletionState(data);
              return;
            }

            // Still processing: keep UI in a non-error state.
            setError(null);
            setStage('complete');
          });
      }, 180000);

      return () => {
        cancelled = true;
        stageTimers.forEach(clearTimeout);
        clearTimeout(timeoutTimer);
        supabase.removeChannel(channel);
      };
    }, [submissionId, pageCount, onComplete, isComplete, applyBackendCompletionState]);

    const StageIcon = stage === 'analyzing' ? Brain : 
                      stage === 'fetching' ? Eye :
                      stage === 'comparing' ? FileCheck :
                      stage === 'uploading' ? FileSearch :
                      CheckCircle;

    const getResultBadge = () => {
      // Only show timeout if we explicitly have an error AND no valid riskLevel came through
      if (error && !riskLevel) {
        return (
          <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold border-muted bg-secondary text-muted-foreground">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Processing
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
                  {error || getStageLabel()}
                </span>
              </div>
              {getResultBadge()}
            </div>

            {/* Page count indicator */}
            {pageCount > 1 && !isComplete && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Image className="w-3 h-3" />
                <span>Verifying {pageCount} pages</span>
              </div>
            )}

            {/* Progress Bar */}
            <Progress 
              value={getProgress()} 
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
                Profile
              </span>
              <span className={['comparing', 'complete'].includes(stage) ? 'text-primary' : ''}>
                {pageCount > 1 ? 'Pages' : 'Analysis'}
              </span>
              <span className={stage === 'complete' ? 'text-primary' : ''}>Complete</span>
            </div>

            {/* Per-page results preview */}
            {isComplete && pageResults.length > 1 && (
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs font-medium mb-2">Per-page scores:</p>
                <div className="flex flex-wrap gap-1">
                  {pageResults.map((result: PageResult, idx: number) => (
                    <span
                      key={idx}
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded text-xs",
                        result.same_writer 
                          ? "bg-green-500/10 text-green-600"
                          : result.similarity >= 50 
                            ? "bg-yellow-500/10 text-yellow-600"
                            : "bg-red-500/10 text-red-600"
                      )}
                    >
                      P{result.page}: {result.similarity}%
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis Details */}
            {isComplete && !error && pageResults.length <= 1 && (
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs text-muted-foreground">
                  {riskLevel === 'low' && 'Handwriting verified successfully. Your submission matches your profile.'}
                  {riskLevel === 'medium' && errorType === 'no_profile' && 'No handwriting profile found. Please upload your handwriting sample.'}
                  {riskLevel === 'medium' && errorType === 'file_too_large' && 'File too large for automatic analysis. Try using smaller images.'}
                  {riskLevel === 'medium' && errorType === 'typed_content_detected' && 'Typed/printed content detected. Please submit handwritten pages only.'}
                  {riskLevel === 'medium' && !errorType && 'Some differences detected. Faculty will review your submission.'}
                  {riskLevel === 'high' && 'Significant differences detected. Please reupload clear handwritten images.'}
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