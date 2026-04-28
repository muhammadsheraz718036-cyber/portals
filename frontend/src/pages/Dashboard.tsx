import { useMemo } from "react";
import {
  ClipboardList,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Users,
  ShieldCheck,
  Building2,
  FileText,
  GitBranch,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-hooks";
import {
  useApprovalChains,
  useApprovalRequests,
  useApprovalTypes,
  useDepartments,
  useProfiles,
  useRoles,
} from "@/hooks/services";
import type { RequestStatus } from "@/lib/constants";

type RequestRow = {
  status: RequestStatus;
};

type DashboardCard = {
  label: string;
  value: number | string;
  icon: LucideIcon;
  path: string;
  show?: boolean;
  tone: {
    card: string;
    iconBg: string;
    subtext: string;
  };
  detail: string;
};

const cardTones = {
  rose: {
    card: "bg-[#f5e7ea]",
    iconBg: "bg-[#b86b7a]",
    subtext: "text-[#8b4f5b]",
  },
  amber: {
    card: "bg-[#f3ead8]",
    iconBg: "bg-[#a9864d]",
    subtext: "text-[#7f653a]",
  },
  mint: {
    card: "bg-[#e2eee6]",
    iconBg: "bg-[#6b9277]",
    subtext: "text-[#526f5b]",
  },
  lilac: {
    card: "bg-[#ece8f3]",
    iconBg: "bg-[#8574a6]",
    subtext: "text-[#665982]",
  },
  sky: {
    card: "bg-[#e2edf3]",
    iconBg: "bg-[#638da3]",
    subtext: "text-[#4b6c7d]",
  },
  violet: {
    card: "bg-[#eee8ee]",
    iconBg: "bg-[#8a6f88]",
    subtext: "text-[#6c566a]",
  },
  emerald: {
    card: "bg-[#e5eee1]",
    iconBg: "bg-[#789568]",
    subtext: "text-[#5b714f]",
  },
  blue: {
    card: "bg-[#e4eaf2]",
    iconBg: "bg-[#697fa0]",
    subtext: "text-[#50617a]",
  },
  coral: {
    card: "bg-[#f3e6df]",
    iconBg: "bg-[#aa7963]",
    subtext: "text-[#805b4a]",
  },
} satisfies Record<string, { card: string; iconBg: string; subtext: string }>;

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin, hasPermission } = useAuth();

  const {
    data: requests = [],
    isLoading: loading,
  } = useApprovalRequests() as {
    data: RequestRow[];
    isLoading: boolean;
  };
  const { data: users = [] } = useProfiles();
  const { data: roles = [] } = useRoles();
  const { data: departments = [] } = useDepartments();
  const { data: approvalTypes = [] } = useApprovalTypes();
  const { data: approvalChains = [] } = useApprovalChains();

  const stats = useMemo(() => {
    const total = requests.length;
    const approved = requests.filter((r) => r.status === "approved").length;
    const rejected = requests.filter((r) => r.status === "rejected").length;
    const pending = requests.filter((r) => r.status === "pending").length;
    const inProgress = requests.filter((r) => r.status === "in_progress").length;

    return [
      {
        label: "Total Requests",
        value: total,
        icon: ClipboardList,
        path: "/approvals",
        tone: cardTones.rose,
        detail: `${pending + inProgress} active requests`,
      },
      {
        label: "Approved",
        value: approved,
        icon: CheckCircle,
        path: "/approvals?status=approved",
        tone: cardTones.mint,
        detail: "Completed requests",
      },
      {
        label: "Rejected",
        value: rejected,
        icon: XCircle,
        path: "/approvals?status=rejected",
        tone: cardTones.coral,
        detail: "Declined requests",
      },
      {
        label: "Pending",
        value: pending,
        icon: Clock,
        path: "/approvals?status=pending",
        tone: cardTones.amber,
        detail: "Awaiting approval",
      },
    ] satisfies DashboardCard[];
  }, [requests]);

  const canManage = (permission: string) =>
    isAdmin || hasPermission(permission) || hasPermission("all");

  const adminCards = [
    {
      label: "Users",
      value: users.length,
      icon: Users,
      path: "/admin?tab=users",
      show: canManage("manage_users"),
      tone: cardTones.sky,
      detail: "Team members",
    },
    {
      label: "Roles & Permissions",
      value: roles.length,
      icon: ShieldCheck,
      path: "/admin?tab=roles",
      show: canManage("manage_roles"),
      tone: cardTones.violet,
      detail: "Access groups",
    },
    {
      label: "Departments",
      value: departments.length,
      icon: Building2,
      path: "/admin?tab=departments",
      show: canManage("manage_departments"),
      tone: cardTones.emerald,
      detail: "Active departments",
    },
    {
      label: "Approval Types",
      value: approvalTypes.length,
      icon: FileText,
      path: "/admin?tab=approval-types",
      show: canManage("manage_approval_types"),
      tone: cardTones.blue,
      detail: "Request templates",
    },
    {
      label: "Approval Chains",
      value: approvalChains.length,
      icon: GitBranch,
      path: "/admin?tab=chains",
      show: canManage("manage_chains"),
      tone: cardTones.lilac,
      detail: "Workflow paths",
    },
  ].filter((card) => card.show) satisfies DashboardCard[];

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
          Overview of approval requests
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Request Overview
        </h2>
        <div className="grid auto-rows-[132px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((card) => (
            <MetricCard key={card.label} card={card} onNavigate={navigate} />
          ))}
        </div>
      </section>

      {adminCards.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Administration
          </h2>
          <div className="grid auto-rows-[132px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {adminCards.map((card) => (
              <MetricCard key={card.label} card={card} onNavigate={navigate} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MetricCard({
  card,
  onNavigate,
}: {
  card: DashboardCard;
  onNavigate: (path: string) => void;
}) {
  return (
    <Card
      className={`h-full cursor-pointer border-0 shadow-none transition-snappy hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${card.tone.card}`}
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(card.path)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onNavigate(card.path);
        }
      }}
    >
      <CardContent className="flex h-full items-center justify-start gap-3 p-4">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${card.tone.iconBg}`}
        >
          <card.icon className="h-8 w-8 text-white" />
        </div>
        <div className="min-w-0 text-left">
          <p className="text-[1.65rem] font-bold leading-none text-slate-950">
            {card.value}
          </p>
          <p className="mt-1 truncate text-left text-xs font-semibold text-slate-800">
            {card.label}
          </p>
          <p
            className={`mt-2 truncate text-left text-[11px] font-medium ${card.tone.subtext}`}
          >
            {card.detail}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
