import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import {
  DateRangeSelector,
  type DateRangeValue,
} from "@/components/DateRangeSelector";
import { useAuth } from "@/contexts/auth-hooks";
import {
  useApprovalRequests,
  useDepartmentsForUsers,
  useProfileNames,
} from "@/hooks/services";
import { useDebounce } from "@/hooks/useDebounce";
import type { RequestStatus } from "@/lib/constants";
import { isWithinDateRange } from "@/lib/dateFilters";

type RequestRow = {
  id: string;
  request_number: string;
  status: RequestStatus;
  work_assignee_id?: string | null;
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
  key: "all" | "approval" | "my" | "other";
  label: string;
  count: number;
  emptyMessage: string;
  requests: RequestRow[];
};

const DEPARTMENT_FALLBACK = "No Department Assigned";
const STATUS_FILTERS = new Set([
  "all",
  "pending",
  "in_progress",
  "approved",
  "rejected",
]);
const TAB_FILTERS = new Set(["all", "approval", "my", "other"]);

function getDepartmentLabel(request: RequestRow) {
  return request.departments?.name?.trim() || DEPARTMENT_FALLBACK;
}

function getInitialStatusFilter(value: string | null): string {
  if (!value) return "all";
  return STATUS_FILTERS.has(value) ? value : "all";
}

export default function Approvals() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, hasPermission } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    getInitialStatusFilter(searchParams.get("status")),
  );
  const [activeTab, setActiveTab] = useState<string>(() => {
    const value = searchParams.get("tab");
    return value && TAB_FILTERS.has(value) ? value : "all";
  });
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRangeValue>({
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
  });
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
        const statusMatches =
          statusFilter === "all" ||
          request.status === statusFilter;

        if (!statusMatches) {
          return false;
        }

        if (
          departmentFilter !== "all" &&
          getDepartmentLabel(request) !== departmentFilter
        ) {
          return false;
        }

        if (!isWithinDateRange(request.created_at, dateRange.from, dateRange.to)) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const initiatorName = (names[request.initiator_id] ?? "").toLowerCase();
        const typeName = (request.approval_types?.name ?? "").toLowerCase();
        const departmentName = getDepartmentLabel(request).toLowerCase();
        const submittedDate = new Date(request.created_at);
        const isoDate = request.created_at.slice(0, 10).toLowerCase();
        const localDate = submittedDate.toLocaleDateString().toLowerCase();

        return (
          request.request_number.toLowerCase().includes(normalizedSearch) ||
          initiatorName.includes(normalizedSearch) ||
          typeName.includes(normalizedSearch) ||
          departmentName.includes(normalizedSearch) ||
          isoDate.includes(normalizedSearch) ||
          localDate.includes(normalizedSearch)
        );
      });

    return {
      allRequests: applyFilters(rows),
      myRequests: applyFilters(segregated.myRequests),
      approvalRequests: applyFilters(segregated.approvalRequests),
      allOther: applyFilters(segregated.allOther),
    };
  }, [
    dateRange,
    debouncedSearch,
    departmentFilter,
    names,
    rows,
    segregated,
    statusFilter,
  ]);

  const tabs = useMemo(() => {
    const canReview =
      isAdmin || hasPermission("approve_reject") || hasPermission("all");
    const canViewAllRequests =
      isAdmin || hasPermission("view_all_requests") || hasPermission("all");

    const nextTabs: TabDefinition[] = [];

    nextTabs.push({
      key: "all",
      label: "All",
      count: filtered.allRequests.length,
      emptyMessage: "No requests match your filters.",
      requests: filtered.allRequests,
    });

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

    if (canViewAllRequests) {
      nextTabs.push({
        key: "other",
        label: "Submitted by Others",
        count: filtered.allOther.length,
        emptyMessage: "No requests from other users match your filters.",
        requests: filtered.allOther,
      });
    }

    return nextTabs;
  }, [filtered, hasPermission, isAdmin]);

  useEffect(() => {
    if (tabs.some((tab) => tab.key === activeTab)) {
      return;
    }

    setActiveTab("all");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("tab");
      return next;
    });
  }, [activeTab, setSearchParams, tabs]);

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "all") {
        next.delete("status");
      } else {
        next.set("status", value);
      }
      return next;
    });
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "all") {
        next.delete("tab");
      } else {
        next.set("tab", value);
      }
      return next;
    });
  };

  const handleDateRangeChange = (value: DateRangeValue) => {
    setDateRange(value);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value.from) {
        next.set("from", value.from);
      } else {
        next.delete("from");
      }
      if (value.to) {
        next.set("to", value.to);
      } else {
        next.delete("to");
      }
      return next;
    });
  };

  const renderTable = (requests: RequestRow[]) => (
    <>
      <div className="space-y-3 md:hidden">
        {requests.map((request) => (
          <button
            key={request.id}
            type="button"
            className="w-full rounded-xl border bg-card p-4 text-left transition-snappy hover:bg-muted/30"
            onClick={() => navigate(`/approvals/${request.id}`)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="whitespace-nowrap text-sm font-semibold text-primary">
                  {request.request_number}
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {request.approval_types?.name ?? "-"}
                </p>
              </div>
              <StatusBadge status={request.status} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Submitted By
                </p>
                <p className="mt-1 text-foreground">
                  {names[request.initiator_id] ?? "-"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Department
                </p>
                <p className="mt-1 text-foreground">
                  {getDepartmentLabel(request)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Progress
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${request.total_steps ? (request.current_step / request.total_steps) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {request.current_step}/{request.total_steps}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Submitted On
                </p>
                <p className="mt-1 text-foreground">
                  {new Date(request.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
      <table className="min-w-[980px] w-full table-fixed text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="w-[140px] whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Request No.
            </th>
            <th className="w-[190px] whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Request Type
            </th>
            <th className="w-[230px] whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Submitted By
            </th>
            <th className="w-[150px] whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Initiator Department
            </th>
            <th className="w-[130px] whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </th>
            <th className="w-[130px] whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Progress
            </th>
            <th className="w-[120px] whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
              <td className="px-4 py-3 align-top font-medium text-primary">
                <span className="whitespace-nowrap">
                {request.request_number}
                </span>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="hyphens-none break-normal">
                {request.approval_types?.name ?? "-"}
                </div>
              </td>
              <td className="px-4 py-3 align-top">
                <div className="hyphens-none break-normal">
                {names[request.initiator_id] ?? "-"}
                </div>
              </td>
              <td className="px-4 py-3 align-top text-muted-foreground">
                {getDepartmentLabel(request)}
              </td>
              <td className="px-4 py-3 align-top">
                <StatusBadge status={request.status} />
              </td>
              <td className="px-4 py-3 align-top">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${request.total_steps ? (request.current_step / request.total_steps) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {request.current_step}/{request.total_steps}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                <span className="whitespace-nowrap">
                {new Date(request.created_at).toLocaleDateString()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
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
                placeholder="Search by request no., type, person, department, or date..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Request status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Request Statuses</SelectItem>
                <SelectItem value="pending">Pending Approval</SelectItem>
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
            <DateRangeSelector
              value={dateRange}
              onChange={handleDateRangeChange}
            />
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList
              className="grid w-full"
              style={{
                gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
              }}
            >
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
