import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth-hooks";
import {
  useApprovalRequests,
  useDepartmentsForUsers,
  useProfileNames,
} from "@/hooks/services";
import { useDebounce } from "@/hooks/useDebounce";
import type { RequestStatus } from "@/lib/constants";

type RequestRow = {
  id: string;
  request_number: string;
  status: RequestStatus;
  current_step: number;
  current_step_role: string;
  total_steps: number;
  created_at: string;
  initiator_id: string;
  approval_types: { name: string } | null;
  departments: { name: string } | null;
  is_initiator: boolean;
  needs_approval: boolean;
  has_acted?: boolean;
};

type TabDefinition = {
  key: "approval" | "my" | "other";
  label: string;
  count: number;
  emptyMessage: string;
  requests: RequestRow[];
};

const DEPARTMENT_FALLBACK = "No Department Assigned";

function getDepartmentLabel(request: RequestRow) {
  return request.departments?.name?.trim() || DEPARTMENT_FALLBACK;
}

export default function Approvals() {
  const navigate = useNavigate();
  const { isAdmin, hasPermission } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data: rows = [], isLoading: loading } = useApprovalRequests() as {
    data: RequestRow[];
    isLoading: boolean;
  };
  const { data: departments = [] } = useDepartmentsForUsers();

  const initiatorIds = useMemo(
    () => [...new Set(rows.map((request) => request.initiator_id))],
    [rows],
  );
  const { data: names = {} } = useProfileNames(initiatorIds);

  const segregated = useMemo(() => {
    const myRequests = rows.filter((request) => request.is_initiator);
    const approvalRequests = rows.filter((request) => {
      if (!(request.needs_approval || request.has_acted)) return false;
      return isAdmin || hasPermission("approve_reject") || hasPermission("all");
    });
    const allOther = rows.filter(
      (request) =>
        !request.is_initiator &&
        !request.needs_approval &&
        !request.has_acted,
    );

    return { myRequests, approvalRequests, allOther };
  }, [rows, isAdmin, hasPermission]);

  const filtered = useMemo(() => {
    const normalizedSearch = debouncedSearch.trim().toLowerCase();

    const applyFilters = (requests: RequestRow[]) =>
      requests.filter((request) => {
        if (statusFilter !== "all" && request.status !== statusFilter) {
          return false;
        }

        if (
          departmentFilter !== "all" &&
          getDepartmentLabel(request) !== departmentFilter
        ) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const initiatorName = (names[request.initiator_id] ?? "").toLowerCase();
        const typeName = (request.approval_types?.name ?? "").toLowerCase();
        const departmentName = getDepartmentLabel(request).toLowerCase();

        return (
          request.request_number.toLowerCase().includes(normalizedSearch) ||
          initiatorName.includes(normalizedSearch) ||
          typeName.includes(normalizedSearch) ||
          departmentName.includes(normalizedSearch)
        );
      });

    return {
      myRequests: applyFilters(segregated.myRequests),
      approvalRequests: applyFilters(segregated.approvalRequests),
      allOther: applyFilters(segregated.allOther),
    };
  }, [debouncedSearch, departmentFilter, names, segregated, statusFilter]);

  const tabs = useMemo(() => {
    const canReview =
      isAdmin || hasPermission("approve_reject") || hasPermission("all");

    const nextTabs: TabDefinition[] = [];

    if (canReview) {
      nextTabs.push({
        key: "approval",
        label: "Waiting for Your Review",
        count: filtered.approvalRequests.length,
        emptyMessage: "No requests are waiting for your review.",
        requests: filtered.approvalRequests,
      });
    }

    nextTabs.push({
      key: "my",
      label: "Submitted By You",
      count: filtered.myRequests.length,
      emptyMessage: "You have not submitted any requests yet.",
      requests: filtered.myRequests,
    });

    if (isAdmin) {
      nextTabs.push({
        key: "other",
        label: "Submitted by Other Teams",
        count: filtered.allOther.length,
        emptyMessage: "No requests from other teams match your filters.",
        requests: filtered.allOther,
      });
    }

    return nextTabs;
  }, [filtered, hasPermission, isAdmin]);

  const tabsListClassName =
    tabs.length === 1
      ? "grid w-full grid-cols-1"
      : tabs.length === 2
        ? "grid w-full grid-cols-2"
        : "grid w-full grid-cols-3";

  const renderTable = (requests: RequestRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Request No.
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Request Type
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Submitted By
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Initiator Department
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Progress
            </th>
            <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Submitted On
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {requests.map((request) => (
            <tr
              key={request.id}
              className="cursor-pointer transition-snappy hover:bg-muted/30"
              onClick={() => navigate(`/approvals/${request.id}`)}
            >
              <td className="px-4 py-3 font-medium text-primary">
                {request.request_number}
              </td>
              <td className="px-4 py-3">
                {request.approval_types?.name ?? "-"}
              </td>
              <td className="px-4 py-3">
                {names[request.initiator_id] ?? "-"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {getDepartmentLabel(request)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={request.status} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${request.total_steps ? (request.current_step / request.total_steps) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {request.current_step}/{request.total_steps}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {new Date(request.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Request Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review requests using search and department filters
          </p>
        </div>
        <Button onClick={() => navigate("/approvals/new")} className="gap-2">
          <Plus className="h-4 w-4" />
          New Request
        </Button>
      </div>

      <Card className="border">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by request no., type, person, or department..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.name}>
                    {department.name}
                  </SelectItem>
                ))}
                {!departments.some(
                  (department) => department.name === DEPARTMENT_FALLBACK,
                ) && (
                  <SelectItem value={DEPARTMENT_FALLBACK}>
                    {DEPARTMENT_FALLBACK}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs defaultValue={tabs[0]?.key ?? "my"} className="w-full">
            <TabsList className={tabsListClassName}>
              {tabs.map((tab) => (
                <TabsTrigger key={tab.key} value={tab.key}>
                  {tab.label} ({tab.count})
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((tab) => (
              <TabsContent key={tab.key} value={tab.key} className="mt-0">
                {tab.requests.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    {tab.emptyMessage}
                  </div>
                ) : (
                  renderTable(tab.requests)
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
