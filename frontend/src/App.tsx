import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { toast } from "sonner";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute default
      refetchOnWindowFocus: false, // Prevent unnecessary refetches
      refetchOnReconnect: false, // Prevent unnecessary refetches
      retry: (failureCount, error) => {
        // Only retry on network errors, not on 4xx/5xx
        if (error?.message?.includes('401') || error?.message?.includes('403') || error?.message?.includes('404')) {
          return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      retry: 1, // Only retry mutations once
    },
  },
});

// Global error handler for React Query
queryClient.setDefaultOptions({
  queries: {
    ...queryClient.getDefaultOptions().queries,
  },
  mutations: {
    ...queryClient.getDefaultOptions().mutations,
  },
});

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider>
          <CompanyProvider>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/*" element={<ProtectedRoutes />} />
              </Routes>
              <Sonner />
            </AuthProvider>
          </CompanyProvider>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
