import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, FileText, ExternalLink, Clock, CheckCircle, Shield, AlertTriangle, RefreshCw, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const navItems = [
  { label: 'Overview', href: '/student', icon: DashboardIcons.Home },
  { label: 'Assignments', href: '/student/assignments', icon: DashboardIcons.BookOpen },
  { label: 'My Submissions', href: '/student/submissions', icon: DashboardIcons.FileText },
  { label: 'My Handwriting', href: '/student/handwriting', icon: DashboardIcons.FileText },
  { label: 'Grades', href: '/student/grades', icon: DashboardIcons.CheckCircle },
];

// Client-side timeout for verification (5 minutes)
const VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000;

interface Submission {
  id: string;
  file_url: string;
  file_type: string;
  status: string | null;
  marks: number | null;
  feedback: string | null;
  is_late: boolean | null;
  submitted_at: string;
  verified_at: string | null;
  ai_risk_level: string | null;
  assignment: {
    id: string;
    title: string;
    year: number;
    branch: string;
    section: string;
    deadline: string;
  };
}

const StudentSubmissions = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [studentDetails, setStudentDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'student')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  const fetchSubmissions = useCallback(async () => {
    if (!profile) return;
    
    const { data, error } = await supabase
      .from('submissions')
      .select(`
        id,
        file_url,
        file_type,
        status,
        marks,
        feedback,
        is_late,
        submitted_at,
        verified_at,
        ai_risk_level,
        assignment:assignments (
          id,
          title,
          year,
          branch,
          section,
          deadline
        )
      `)
      .eq('student_profile_id', profile.id)
      .order('submitted_at', { ascending: false });

    if (!error && data) {
      setSubmissions(data as unknown as Submission[]);
    }
  }, [profile]);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile) return;

      try {
        const { data: detailsRes } = await supabase
          .from('student_details')
          .select('*')
          .eq('profile_id', profile.id)
          .maybeSingle();

        setStudentDetails(detailsRes);
        await fetchSubmissions();
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (profile?.role === 'student') {
      fetchData();
    }
  }, [profile, fetchSubmissions]);

  // Real-time subscription for verification status updates
  useEffect(() => {
    if (!profile) return;

    const channel = supabase
      .channel('submission-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'submissions',
          filter: `student_profile_id=eq.${profile.id}`,
        },
        (payload) => {
          console.log('Submission updated:', payload);
          const updated = payload.new as any;
          
          // Update the local state with the new data
          setSubmissions(prev => 
            prev.map(sub => 
              sub.id === updated.id 
                ? { ...sub, ...updated }
                : sub
            )
          );

          // Show toast notification for verification completion
          if (updated.verified_at && updated.ai_risk_level) {
            switch (updated.ai_risk_level) {
              case 'low':
                toast.success('Verification complete: Handwriting verified!');
                break;
              case 'medium':
                toast.info('Verification complete: Under review');
                break;
              case 'high':
                toast.warning('Verification complete: Flagged for review');
                break;
              case 'unverified':
                toast.info('Verification skipped: No handwriting sample on file.');
                break;
              case 'failed':
                toast.error('Verification error: Automatic analysis failed, manual review required.');
                break;
              case 'needs_manual_review':
                toast.info('Verification complete: Awaiting manual review.');
                break;
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile]);

  const getVerificationBadge = (submission: Submission) => {
    const hasVerificationResult = !!submission.verified_at;
    const level = submission.ai_risk_level;

    // Check for client-side timeout (5 minutes without verification)
    if (!hasVerificationResult && submission.submitted_at) {
      const submittedTime = new Date(submission.submitted_at).getTime();
      const now = Date.now();
      if (now - submittedTime > VERIFICATION_TIMEOUT_MS) {
        return (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary" className="gap-1">
                <RefreshCw className="w-3 h-3" />
                Manual Review
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Verification timed out - awaiting manual review</p>
            </TooltipContent>
          </Tooltip>
        );
      }
    }

    if (!hasVerificationResult || !level || level === 'pending') {
      return (
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Verifying
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Handwriting verification in progress</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    switch (level) {
      case 'low':
        return (
          <Tooltip>
            <TooltipTrigger>
              <Badge className="bg-green-500/10 text-green-600 gap-1">
                <CheckCircle className="w-3 h-3" />
                Verified
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Handwriting matches your reference sample</p>
            </TooltipContent>
          </Tooltip>
        );
      case 'medium':
        return (
          <Tooltip>
            <TooltipTrigger>
              <Badge className="bg-yellow-500/10 text-yellow-600 gap-1">
                <AlertTriangle className="w-3 h-3" />
                Under Review
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Your submission is being reviewed</p>
            </TooltipContent>
          </Tooltip>
        );
      case 'high':
        return (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="w-3 h-3" />
                Flagged
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Your submission has been flagged for review</p>
            </TooltipContent>
          </Tooltip>
        );
      case 'unverified':
        return (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="outline" className="gap-1">
                <Shield className="w-3 h-3" />
                No Sample
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Upload your handwriting sample to enable verification</p>
            </TooltipContent>
          </Tooltip>
        );
      case 'failed':
        return (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary" className="bg-red-500/10 text-red-600 gap-1">
                <XCircle className="w-3 h-3" />
                AI Error
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Automatic verification failed due to a technical issue</p>
            </TooltipContent>
          </Tooltip>
        );
      case 'needs_manual_review':
        return (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary" className="gap-1">
                <RefreshCw className="w-3 h-3" />
                Needs Review
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>File too large or complex for automatic verification</p>
            </TooltipContent>
          </Tooltip>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <Shield className="w-3 h-3" />
            Pending
          </Badge>
        );
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

  return (
    <DashboardLayout title="My Submissions" role="student" navItems={navItems}>
      {studentDetails && (
        <div className="mb-4 text-sm text-muted-foreground">
          {studentDetails.branch} • Year {studentDetails.year} • Semester {studentDetails.semester} • Section {studentDetails.section}
        </div>
      )}

      {submissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No submissions yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead>Feedback</TableHead>
                  <TableHead className="text-right">File</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((submission) => (
                  <TableRow key={submission.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{submission.assignment?.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Due: {format(new Date(submission.assignment?.deadline), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          {format(new Date(submission.submitted_at), 'MMM d, h:mm a')}
                        </span>
                        {submission.is_late && (
                          <Badge variant="destructive" className="text-xs">Late</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={submission.status === 'graded' ? 'default' : 'outline'}>
                        {submission.status === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                        {submission.status === 'graded' && <CheckCircle className="w-3 h-3 mr-1" />}
                        {submission.status || 'Pending'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {getVerificationBadge(submission)}
                    </TableCell>
                    <TableCell>
                      {submission.marks !== null ? (
                        <span className="font-medium text-student">{submission.marks}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm max-w-[200px] truncate">
                        {submission.feedback || '-'}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <a href={submission.file_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
};

export default StudentSubmissions;
