import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout, DashboardIcons } from '@/components/dashboard/DashboardLayout';
import type { Database } from '@/integrations/supabase/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { 
  Loader2, AlertTriangle, CheckCircle, Shield, Eye, 
  TrendingUp, Users, FileText, ExternalLink 
} from 'lucide-react';
import { format } from 'date-fns';

const navItems = [
  { label: 'Overview', href: '/admin', icon: DashboardIcons.Home },
  { label: 'Students', href: '/admin/students', icon: DashboardIcons.Users },
  { label: 'Faculty', href: '/admin/faculty', icon: DashboardIcons.Users },
  { label: 'Section Mapping', href: '/admin/sections', icon: DashboardIcons.FolderOpen },
  { label: 'Assignments', href: '/admin/assignments', icon: DashboardIcons.BookOpen },
  { label: 'Handwriting', href: '/admin/handwriting', icon: DashboardIcons.FileText },
  { label: 'AI Reports', href: '/admin/verification-reports', icon: DashboardIcons.AlertTriangle },
];

interface VerificationReport {
  id: string;
  ai_similarity_score: number | null;
  ai_confidence_score: number | null;
  ai_risk_level: string | null;
  ai_flagged_sections: string[] | null;
  ai_analysis_details: Database['public']['Tables']['submissions']['Row']['ai_analysis_details'];
  verified_at: string | null;
  submitted_at: string;
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
  file_url: string;
}

const VerificationReportsPage = () => {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<VerificationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [selectedReport, setSelectedReport] = useState<VerificationReport | null>(null);

  useEffect(() => {
    if (!authLoading && (!profile || profile.role !== 'admin')) {
      navigate('/auth');
    }
  }, [profile, authLoading, navigate]);

  useEffect(() => {
    const fetchReports = async () => {
      if (!profile) return;

      try {
        const { data, error } = await supabase
          .from('submissions')
          .select(`
            id,
            ai_similarity_score,
            ai_confidence_score,
            ai_risk_level,
            ai_flagged_sections,
            ai_analysis_details,
            verified_at,
            submitted_at,
            file_url,
            student_profile:profiles!submissions_student_profile_id_fkey (
              id,
              full_name,
              email
            ),
            assignment:assignments (
              id,
              title,
              year,
              branch,
              section
            )
          `)
          .not('verified_at', 'is', null)
          .order('verified_at', { ascending: false });

        if (error) throw error;
        setReports(data as unknown as VerificationReport[] || []);
      } catch (error) {
        console.error('Error fetching reports:', error);
        toast.error('Failed to load verification reports');
      } finally {
        setLoading(false);
      }
    };

    if (profile?.role === 'admin') {
      fetchReports();
    }
  }, [profile]);

  const filteredReports = reports.filter(report => {
    if (filterRisk === 'all') return true;
    return report.ai_risk_level === filterRisk;
  });

  const stats = {
    total: reports.length,
    lowRisk: reports.filter(r => r.ai_risk_level === 'low').length,
    mediumRisk: reports.filter(r => r.ai_risk_level === 'medium').length,
    highRisk: reports.filter(r => r.ai_risk_level === 'high').length,
    unverified: reports.filter(r => r.ai_risk_level === 'unverified').length,
  };

  const getRiskBadge = (level: string | null) => {
    switch (level) {
      case 'high':
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />Reupload Required</Badge>;
      case 'medium':
        return <Badge className="bg-warning text-warning-foreground gap-1"><AlertTriangle className="w-3 h-3" />Manual Review</Badge>;
      case 'low':
        return <Badge className="bg-green-500/10 text-green-600 gap-1"><CheckCircle className="w-3 h-3" />Verified</Badge>;
      case 'unverified':
        return <Badge variant="outline" className="gap-1"><Shield className="w-3 h-3" />Unverified</Badge>;
      default:
        return <Badge variant="outline">Not Analyzed</Badge>;
    }
  };

  const getScoreColor = (score: number | null) => {
    if (score === null) return 'text-muted-foreground';
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-warning';
    return 'text-destructive';
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-admin" />
      </div>
    );
  }

  if (!profile || profile.role !== 'admin') {
    return null;
  }

  return (
    <DashboardLayout title="AI Verification Reports" role="admin" navItems={navItems}>
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-admin/10">
              <FileText className="w-6 h-6 text-admin" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Verified</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-green-500/10">
              <CheckCircle className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.lowRisk}</p>
              <p className="text-sm text-muted-foreground">Verified</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-warning/10">
              <AlertTriangle className="w-6 h-6 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.mediumRisk}</p>
              <p className="text-sm text-muted-foreground">Manual Review</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-destructive/10">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.highRisk}</p>
              <p className="text-sm text-muted-foreground">Reupload Required</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-full bg-muted">
              <Shield className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.unverified}</p>
              <p className="text-sm text-muted-foreground">Unverified</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filter Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={filterRisk} onValueChange={setFilterRisk}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by risk level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risk Levels</SelectItem>
              <SelectItem value="high">Reupload Required</SelectItem>
              <SelectItem value="medium">Manual Review</SelectItem>
              <SelectItem value="low">Verified</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle>Verification Results</CardTitle>
          <CardDescription>{filteredReports.length} record(s) found</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Assignment</TableHead>
                <TableHead>Risk Level</TableHead>
                <TableHead>Similarity</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Verified At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No verification reports found
                  </TableCell>
                </TableRow>
              ) : (
                filteredReports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{report.student_profile?.full_name}</p>
                        <p className="text-xs text-muted-foreground">{report.student_profile?.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{report.assignment?.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {report.assignment?.branch} • Year {report.assignment?.year} • Sec {report.assignment?.section}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{getRiskBadge(report.ai_risk_level)}</TableCell>
                    <TableCell>
                      <span className={`font-bold ${getScoreColor(report.ai_similarity_score)}`}>
                        {report.ai_similarity_score !== null ? `${report.ai_similarity_score}%` : '-'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={getScoreColor(report.ai_confidence_score)}>
                        {report.ai_confidence_score !== null ? `${report.ai_confidence_score}%` : '-'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {report.verified_at 
                        ? format(new Date(report.verified_at), 'MMM d, h:mm a')
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => setSelectedReport(report)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          Details
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={report.file_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={!!selectedReport} onOpenChange={() => setSelectedReport(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Verification Analysis Details
            </DialogTitle>
          </DialogHeader>
          {selectedReport && (
            <div className="space-y-6">
              {/* Student & Assignment Info */}
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground mb-1">Student</p>
                    <p className="font-medium">{selectedReport.student_profile?.full_name}</p>
                    <p className="text-sm text-muted-foreground">{selectedReport.student_profile?.email}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground mb-1">Assignment</p>
                    <p className="font-medium">{selectedReport.assignment?.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedReport.assignment?.branch} • Year {selectedReport.assignment?.year}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Scores */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Verification Scores</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Risk Level</span>
                    {getRiskBadge(selectedReport.ai_risk_level)}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Similarity Score</span>
                      <span className={`font-bold ${getScoreColor(selectedReport.ai_similarity_score)}`}>
                        {selectedReport.ai_similarity_score ?? 0}%
                      </span>
                    </div>
                    <Progress 
                      value={selectedReport.ai_similarity_score ?? 0} 
                      className="h-2"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Confidence Score</span>
                      <span className={getScoreColor(selectedReport.ai_confidence_score)}>
                        {selectedReport.ai_confidence_score ?? 0}%
                      </span>
                    </div>
                    <Progress 
                      value={selectedReport.ai_confidence_score ?? 0} 
                      className="h-2"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Analysis Details */}
              {selectedReport.ai_analysis_details?.analysis_details && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Detailed Analysis</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {Object.entries(selectedReport.ai_analysis_details.analysis_details).map(([key, value]: [string, { match: boolean; reason?: string }]) => (
                      <div key={key} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                        {value.match ? (
                          <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                        )}
                        <div>
                          <p className="font-medium capitalize">{key.replace(/_/g, ' ')}</p>
                          <p className="text-sm text-muted-foreground">{value.notes}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Overall Conclusion */}
              {selectedReport.ai_analysis_details?.overall_conclusion && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">AI Conclusion</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{selectedReport.ai_analysis_details.overall_conclusion}</p>
                  </CardContent>
                </Card>
              )}

              {/* Flagged Concerns */}
              {selectedReport.ai_flagged_sections && selectedReport.ai_flagged_sections.length > 0 && (
                <Card className="border-destructive/50">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2 text-destructive">
                      <AlertTriangle className="w-4 h-4" />
                      Flagged Concerns
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {selectedReport.ai_flagged_sections.map((concern, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <span className="text-destructive">•</span>
                          {concern}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default VerificationReportsPage;
