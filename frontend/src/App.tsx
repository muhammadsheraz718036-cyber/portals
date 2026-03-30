import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/auth-hooks";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import Approvals from "./pages/Approvals";
import RequestDetail from "./pages/RequestDetail";
import NewRequest from "./pages/NewRequest";
import Profile from "./pages/Profile";
import AdminConsole from "./pages/AdminConsole";
import AuditLogs from "./pages/AuditLogs";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/approvals/new" element={<NewRequest />} />
        <Route path="/approvals/:id" element={<RequestDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin" element={<AdminConsole />} />
        <Route path="/audit-logs" element={<AuditLogs />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <AuthProvider>
        <CompanyProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </BrowserRouter>
        </CompanyProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
