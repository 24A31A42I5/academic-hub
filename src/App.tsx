import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import AdminDashboard from "./pages/admin/AdminDashboard";
import StudentsPage from "./pages/admin/StudentsPage";
import FacultyPage from "./pages/admin/FacultyPage";
import SectionMappingPage from "./pages/admin/SectionMappingPage";
import AssignmentsPage from "./pages/admin/AssignmentsPage";
import FacultyDashboard from "./pages/faculty/FacultyDashboard";
import FacultySections from "./pages/faculty/FacultySections";
import FacultyAssignments from "./pages/faculty/FacultyAssignments";
import FacultySubmissions from "./pages/faculty/FacultySubmissions";
import FacultyReviews from "./pages/faculty/FacultyReviews";
import StudentDashboard from "./pages/student/StudentDashboard";
import StudentAssignments from "./pages/student/StudentAssignments";
import StudentSubmissions from "./pages/student/StudentSubmissions";
import StudentGrades from "./pages/student/StudentGrades";
import StudentHandwriting from "./pages/student/StudentHandwriting";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/students" element={<StudentsPage />} />
            <Route path="/admin/faculty" element={<FacultyPage />} />
            <Route path="/admin/sections" element={<SectionMappingPage />} />
            <Route path="/admin/assignments" element={<AssignmentsPage />} />
            <Route path="/faculty" element={<FacultyDashboard />} />
            <Route path="/faculty/sections" element={<FacultySections />} />
            <Route path="/faculty/assignments" element={<FacultyAssignments />} />
            <Route path="/faculty/submissions" element={<FacultySubmissions />} />
            <Route path="/faculty/reviews" element={<FacultyReviews />} />
            <Route path="/student" element={<StudentDashboard />} />
            <Route path="/student/assignments" element={<StudentAssignments />} />
            <Route path="/student/submissions" element={<StudentSubmissions />} />
            <Route path="/student/grades" element={<StudentGrades />} />
            <Route path="/student/handwriting" element={<StudentHandwriting />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
