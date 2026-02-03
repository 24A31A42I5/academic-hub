import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, AlertTriangle, ExternalLink, CheckCircle, XCircle, Eye, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import FilePreviewDialog from '@/components/faculty/FilePreviewDialog';

const navItems = [
  { label: 'Overview', href: '/faculty', icon: DashboardIcons.Home },
  { label: 'My Sections', href: '/faculty/sections', icon: DashboardIcons.FolderOpen },
  { label: 'Assignments', href: '/faculty/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Submissions', href: '/faculty/submissions', icon: DashboardIcons.FileText },
  { label: 'AI Reviews', href: '/faculty/reviews', icon: DashboardIcons.AlertTriangle },
];

interface AIAnalysisDetails {
  similarity_score: number;
  confidence_score: number;
  risk_level: string;
  analysis_details?: {
    letter_formation?: { match: boolean; notes: string };
    slant_angle?: { match: boolean; notes: string };
    spacing?: { match: boolean; notes: string };
    baseline?: { match: boolean; notes: string };
    unique_features?: { match: boolean; notes: string };
  };
  overall_conclusion?: string;
  flagged_concerns?: string[];
}

interface FlaggedSubmission {
  id: string;
  file_url: string;
  file_type: string;
  status: string | null;
  marks: number | null;
  feedback: string | null;
  submitted_at: string;
  ai_risk_level: string | null;
  ai_similarity_score: number | null;
  ai_confidence_score: number | null;
  ai_flagged_sections: string[] | null;
  ai_analysis_details: AIAnalysisDetails | null;
  student_profile: {
    id: string;
    full_name: string;
    email: string;
  };
  assignment: {
    id: string;
    title: string;
    year: number;
    branch: string;
    section: string;
  };
}

const FacultyReviews = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<FlaggedSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewSubmission, setViewSubmission] = useState<FlaggedSubmission | null>(null);
  const [reviewForm, setReviewForm] = useState({ marks: '', feedback: '', status: '' });
  const [saving, setSaving] = useState(false);
  const [previewSubmission, setPreviewSubmission] = useState<FlaggedSubmission | null>(null);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'faculty')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  const fetchFlagged = async () => {
    if (!profile) return;

    try {
      const { data, error } = await supabase
        .from('submissions')
        .select(`
          id,
          file_url,
          file_type,
          status,
          marks,
          feedback,
          submitted_at,
          ai_risk_level,
          ai_similarity_score,
          ai_confidence_score,
          ai_flagged_sections,
          ai_analysis_details,
          student_profile:profiles!submissions_student_profile_id_fkey (
            id,
            full_name,
            email
          ),
          assignment:assignments!inner (
            id,
            title,
            year,
            branch,
            section,
            faculty_profile_id
          )
        `)
        .eq('assignment.faculty_profile_id', profile.id)
        .in('ai_risk_level', ['high', 'medium'])
        .order('submitted_at', { ascending: false });

      if (error) throw error;
      setSubmissions(data as unknown as FlaggedSubmission[] || []);
    } catch (error) {
      console.error('Error fetching flagged submissions:', error);
      toast.error('Failed to load flagged submissions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.role === 'faculty') {
      fetchFlagged();
    }
  }, [profile]);

  const openReview = (submission: FlaggedSubmission) => {
    setViewSubmission(submission);
    setReviewForm({
      marks: submission.marks?.toString() || '',
      feedback: submission.feedback || '',
      status: submission.status || 'reviewed',
    });
  };

  const handleSaveReview = async () => {
    if (!viewSubmission) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('submissions')
        .update({
          marks: reviewForm.marks ? parseFloat(reviewForm.marks) : null,
          feedback: reviewForm.feedback || null,
          status: reviewForm.status || 'reviewed',
        })
        .eq('id', viewSubmission.id);

      if (error) throw error;

      toast.success('Review saved successfully');
      setViewSubmission(null);
      fetchFlagged();
    } catch (error) {
      console.error('Error saving review:', error);
      toast.error('Failed to save review');
    } finally {
      setSaving(false);
    }
  };

  const getRiskColor = (level: string | null) => {
    switch (level) {
      case 'high':
        return 'border-l-destructive bg-destructive/5';
      case 'medium':
        return 'border-l-warning bg-warning/5';
      default:
        return '';
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-faculty" />
      </div>
    );
  }

  if (!profile || profile.role !== 'faculty') {
    return null;
  }

  const highRiskCount = submissions.filter((s) => s.ai_risk_level === 'high').length;
  const mediumRiskCount = submissions.filter((s) => s.ai_risk_level === 'medium').length;

  return (
    <DashboardLayout title="AI Reviews" role="faculty" navItems={navItems}>
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-destructive/10">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{highRiskCount}</p>
              <p className="text-sm text-muted-foreground">High Risk</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-warning/10">
              <AlertTriangle className="w-6 h-6 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">{mediumRiskCount}</p>
              <p className="text-sm text-muted-foreground">Manual Review</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-muted">
              <CheckCircle className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{submissions.filter((s) => s.status === 'reviewed').length}</p>
              <p className="text-sm text-muted-foreground">Reviewed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {submissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-muted-foreground">No flagged submissions to review</p>
            <p className="text-sm text-muted-foreground mt-2">All submissions appear to be original</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            <Card
              key={submission.id}
              className={`border-l-4 ${getRiskColor(submission.ai_risk_level)}`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold">{submission.student_profile?.full_name}</h3>
                      <Badge variant={submission.ai_risk_level === 'high' ? 'destructive' : 'default'}>
                        {submission.ai_risk_level === 'high' ? 'Reupload Required' : 'Manual Review'}
                      </Badge>
                      {submission.status === 'reviewed' && (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Reviewed
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {submission.student_profile?.email}
                    </p>
                    <div className="flex flex-wrap gap-4 text-sm mb-3">
                      <Badge variant="outline">
                        {submission.assignment?.title}
                      </Badge>
                      <span className="text-muted-foreground">
                        {submission.assignment?.year}Y - {submission.assignment?.branch} - {submission.assignment?.section}
                      </span>
                      <span className="text-muted-foreground">
                        Submitted: {format(new Date(submission.submitted_at), 'MMM d, h:mm a')}
                      </span>
                    </div>

                    {/* AI Analysis Details */}
                    <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                      <div className="flex gap-6">
                        {submission.ai_similarity_score !== null && (
                          <div>
                            <p className="text-xs text-muted-foreground">Similarity Score</p>
                            <p className="font-semibold text-lg">{submission.ai_similarity_score}%</p>
                          </div>
                        )}
                        {submission.ai_confidence_score !== null && (
                          <div>
                            <p className="text-xs text-muted-foreground">AI Confidence</p>
                            <p className="font-semibold text-lg">{submission.ai_confidence_score}%</p>
                          </div>
                        )}
                      </div>
                      
                      {/* Detailed Analysis */}
                      {submission.ai_analysis_details?.analysis_details && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-2 border-t">
                          {Object.entries(submission.ai_analysis_details.analysis_details).map(([key, value]) => (
                            <div key={key} className="text-xs">
                              <p className="text-muted-foreground capitalize">{key.replace('_', ' ')}</p>
                              <div className="flex items-center gap-1">
                                {value.match ? (
                                  <CheckCircle className="w-3 h-3 text-green-500" />
                                ) : (
                                  <XCircle className="w-3 h-3 text-destructive" />
                                )}
                                <span className={value.match ? 'text-green-600' : 'text-destructive'}>
                                  {value.match ? 'Match' : 'Mismatch'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Overall Conclusion */}
                      {submission.ai_analysis_details?.overall_conclusion && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground mb-1">AI Conclusion</p>
                          <p className="text-sm">{submission.ai_analysis_details.overall_conclusion}</p>
                        </div>
                      )}
                      
                      {submission.ai_flagged_sections && submission.ai_flagged_sections.length > 0 && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground mb-1">Flagged Concerns</p>
                          <div className="flex flex-wrap gap-1">
                            {submission.ai_flagged_sections.map((section, idx) => (
                              <Badge key={idx} variant="destructive" className="text-xs">
                                {section}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button variant="ghost" size="sm" asChild>
                      <a href={submission.file_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </Button>
                    <Button variant="faculty" size="sm" onClick={() => openReview(submission)}>
                      <Eye className="w-4 h-4 mr-1" />
                      Review
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!viewSubmission} onOpenChange={() => setViewSubmission(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review Flagged Submission</DialogTitle>
          </DialogHeader>
          {viewSubmission && (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{viewSubmission.student_profile?.full_name}</p>
                      <p className="text-sm text-muted-foreground">{viewSubmission.assignment?.title}</p>
                    </div>
                    <Badge variant={viewSubmission.ai_risk_level === 'high' ? 'destructive' : 'default'}>
                      {viewSubmission.ai_risk_level === 'high' ? 'Reupload Required' : 'Manual Review'}
                    </Badge>
                  </div>
                  <div className="mt-3 flex gap-4 text-sm">
                    <span>Similarity: {viewSubmission.ai_similarity_score}%</span>
                    <span>Confidence: {viewSubmission.ai_confidence_score}%</span>
                  </div>
                  {viewSubmission.file_url && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="mt-3"
                      onClick={() => setPreviewSubmission(viewSubmission)}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View Submitted File
                    </Button>
                  )}
                </CardContent>
              </Card>

              <div>
                <Label>Marks</Label>
                <Input
                  type="number"
                  value={reviewForm.marks}
                  onChange={(e) => setReviewForm({ ...reviewForm, marks: e.target.value })}
                  placeholder="Enter marks (optional)"
                />
              </div>
              <div>
                <Label>Review Feedback</Label>
                <Textarea
                  value={reviewForm.feedback}
                  onChange={(e) => setReviewForm({ ...reviewForm, feedback: e.target.value })}
                  placeholder="Provide your review findings and feedback"
                  rows={4}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setReviewForm({ ...reviewForm, status: 'reviewed' })}
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Mark as Reviewed
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => setReviewForm({ ...reviewForm, status: 'flagged', marks: '0' })}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Confirm Plagiarism
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewSubmission(null)}>
              Cancel
            </Button>
            <Button variant="faculty" onClick={handleSaveReview} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File Preview Dialog */}
      <FilePreviewDialog
        open={!!previewSubmission}
        onOpenChange={() => setPreviewSubmission(null)}
        fileUrl={previewSubmission?.file_url || null}
        fileType={previewSubmission?.file_type || null}
        studentName={previewSubmission?.student_profile?.full_name}
        assignmentTitle={previewSubmission?.assignment?.title}
      />
    </DashboardLayout>
  );
};

export default FacultyReviews;
