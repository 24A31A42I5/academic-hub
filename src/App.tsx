import { lazy, Suspense, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Loader2 } from "lucide-react";

// Eager: landing + auth (first-paint critical)
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// Lazy: role-gated dashboards (split into separate chunks)
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const StudentsPage = lazy(() => import("./pages/admin/StudentsPage"));
const FacultyPage = lazy(() => import("./pages/admin/FacultyPage"));
const SectionMappingPage = lazy(() => import("./pages/admin/SectionMappingPage"));
const AssignmentsPage = lazy(() => import("./pages/admin/AssignmentsPage"));
const HandwritingPage = lazy(() => import("./pages/admin/HandwritingPage"));
const VerificationReportsPage = lazy(() => import("./pages/admin/VerificationReportsPage"));
const FacultyDashboard = lazy(() => import("./pages/faculty/FacultyDashboard"));
const FacultySections = lazy(() => import("./pages/faculty/FacultySections"));
const FacultyAssignments = lazy(() => import("./pages/faculty/FacultyAssignments"));
const FacultySubmissions = lazy(() => import("./pages/faculty/FacultySubmissions"));
const FacultyReviews = lazy(() => import("./pages/faculty/FacultyReviews"));
const StudentDashboard = lazy(() => import("./pages/student/StudentDashboard"));
const StudentAssignments = lazy(() => import("./pages/student/StudentAssignments"));
const SubmitAssignment = lazy(() => import("./pages/student/SubmitAssignment"));
const StudentSubmissions = lazy(() => import("./pages/student/StudentSubmissions"));
const StudentGrades = lazy(() => import("./pages/student/StudentGrades"));
const StudentHandwriting = lazy(() => import("./pages/student/StudentHandwriting"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reasonable defaults — reduce duplicate fetches across components
      staleTime: 30_000,            // 30s freshness window
      gcTime: 5 * 60_000,           // keep cache 5min
      refetchOnWindowFocus: false,  // avoid surprise refetches
      retry: 1,                     // single retry on transient failure
    },
    mutations: {
      retry: 0,
    },
  },
});

// Clear React Query cache on user change to prevent cross-user data leakage
const UserCacheClearer = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const prevUserId = useRef<string | null>(null);

  useEffect(() => {
    const id = user?.id ?? null;
    if (prevUserId.current !== null && id !== prevUserId.current) {
      qc.clear();
    }
    prevUserId.current = id;
  }, [user?.id, qc]);

  return null;
};

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UserCacheClearer />
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/students" element={<StudentsPage />} />
                <Route path="/admin/faculty" element={<FacultyPage />} />
                <Route path="/admin/sections" element={<SectionMappingPage />} />
                <Route path="/admin/assignments" element={<AssignmentsPage />} />
                <Route path="/admin/handwriting" element={<HandwritingPage />} />
                <Route path="/admin/verification-reports" element={<VerificationReportsPage />} />
                <Route path="/faculty" element={<FacultyDashboard />} />
                <Route path="/faculty/sections" element={<FacultySections />} />
                <Route path="/faculty/assignments" element={<FacultyAssignments />} />
                <Route path="/faculty/submissions" element={<FacultySubmissions />} />
                <Route path="/faculty/reviews" element={<FacultyReviews />} />
                <Route path="/student" element={<StudentDashboard />} />
                <Route path="/student/assignments" element={<StudentAssignments />} />
                <Route path="/student/assignments/:assignmentId" element={<SubmitAssignment />} />
                <Route path="/student/submissions" element={<StudentSubmissions />} />
                <Route path="/student/grades" element={<StudentGrades />} />
                <Route path="/student/handwriting" element={<StudentHandwriting />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
