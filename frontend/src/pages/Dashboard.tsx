import { useMemo } from "react";
import {
  ClipboardList,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-hooks";
import { useApprovalRequests, useAuditLogs } from "@/hooks/services";
import type { RequestStatus } from "@/lib/constants";

const getApprovalTypeName = (approvalTypes: unknown): string => {
  if (
    approvalTypes &&
    typeof approvalTypes === "object" &&
    "name" in approvalTypes
  ) {
    return (approvalTypes as { name: string }).name;
  }
  return "—";
};

type RequestRow = {
  id: string;
  request_number: string;
  status: RequestStatus;
  current_step: number;
  total_steps: number;
  created_at: string;
  initiator_id: string;
  approval_types: { name: string } | null;
};

type AuditRow = {
  id: string;
  user_name: string;
  action: string;
  target: string;
  details: string | null;
  created_at: string;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { profile, isAdmin } = useAuth();

  const { data: requests = [], isLoading: loading } = useApprovalRequests() as {
    data: RequestRow[];
    isLoading: boolean;
  };
  const { data: auditLogs = [] } = useAuditLogs();
  // Memoize filtered audit logs to prevent unnecessary recalculations
  const filteredAuditLogs = useMemo(() => {
    return isAdmin ? auditLogs.slice(0, 5) : [];
  }, [auditLogs, isAdmin]);

  const stats = useMemo(() => {
    const total = requests.length;
    const approved = requests.filter((r) => r.status === "approved").length;
    const rejected = requests.filter((r) => r.status === "rejected").length;
    const pending = requests.filter(
      (r) => r.status === "pending" || r.status === "in_progress",
    ).length;
    return [
      {
        label: "Total Requests",
        value: total,
        icon: ClipboardList,
        color: "text-primary",
      },
      {
        label: "Approved",
        value: approved,
        icon: CheckCircle,
        color: "text-success",
      },
      {
        label: "Rejected",
        value: rejected,
        icon: XCircle,
        color: "text-destructive",
      },
      { label: "Pending", value: pending, icon: Clock, color: "text-warning" },
    ];
  }, [requests]);

  const recent = requests.slice(0, 4);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of approval requests and activity
        </p>
        <div className="mt-4 rounded-lg border border-muted/70 bg-muted/40 p-4">
          <p className="text-sm text-foreground/90">
            Welcome back, <span className="font-semibold">{profile?.full_name ?? "there"}</span>!
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Here's a quick summary of your approval activity.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`p-2 rounded bg-muted ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {stat.value}
                </p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Recent Requests
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/approvals")}
                className="text-xs text-primary"
              >
                View All <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {recent.map((req) => (
                <div
                  key={req.id}
                  className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-snappy"
                  onClick={() => navigate(`/approvals/${req.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {req.request_number}
                      </span>
                      <StatusBadge status={req.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {getApprovalTypeName(req.approval_types)}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Step {req.current_step}/{req.total_steps}
                  </div>
                </div>
              ))}
              {recent.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No requests yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Recent Activity
              </CardTitle>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/audit-logs")}
                  className="text-xs text-primary"
                >
                  View All <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {!isAdmin && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Audit activity is visible to administrators.
                </div>
              )}
              {isAdmin &&
                filteredAuditLogs.map((log) => (
                  <div key={log.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {log.user_name}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">
                        {log.action}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {log.details}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      {new Date(log.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              {isAdmin && filteredAuditLogs.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No audit entries yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
