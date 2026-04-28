import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
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
import { isWithinDateRange } from "@/lib/dateFilters";
import type { RequestStatus } from "@/lib/constants";

type RequestRow = {
  id: string;
  request_number: string;
  status: RequestStatus;
  work_status?: "pending" | "assigned" | "in_progress" | "done" | "not_done";
  work_assignee_id?: string | null;
  work_assigned_at?: string | null;
  work_completed_at?: string | null;
  current_step: number;
  total_steps: number;
  created_at: string;
  initiator_id: string;
  approval_types: { name: string } | null;
  departments: { name: string } | null;
};

const DEPARTMENT_FALLBACK = "No Department Assigned";

function normalizeWorkStatus(status?: string | null) {
  if (status === "not_done") return "pending";
  return status || "pending";
}

function getDepartmentLabel(request: RequestRow) {
  return request.departments?.name?.trim() || DEPARTMENT_FALLBACK;
}

export default function AssignedWork() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [workStatusFilter, setWorkStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRangeValue>({
    from: "",
    to: "",
  });
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

  const assignedRows = useMemo(
    () =>
      rows.filter(
        (request) => Boolean(user?.id) && request.work_assignee_id === user?.id,
      ),
    [rows, user?.id],
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = debouncedSearch.trim().toLowerCase();

    return assignedRows.filter((request) => {
      if (
        workStatusFilter !== "all" &&
        normalizeWorkStatus(request.work_status) !== workStatusFilter
      ) {
        return false;
      }

      if (
        departmentFilter !== "all" &&
        getDepartmentLabel(request) !== departmentFilter
      ) {
        return false;
      }

      if (
        !isWithinDateRange(
          request.work_assigned_at || request.created_at,
          dateRange.from,
          dateRange.to,
        )
      ) {
        return false;
      }

      if (!normalizedSearch) return true;

      const initiatorName = (names[request.initiator_id] ?? "").toLowerCase();
      const typeName = (request.approval_types?.name ?? "").toLowerCase();
      const departmentName = getDepartmentLabel(request).toLowerCase();
      const assignedDate = request.work_assigned_at?.slice(0, 10).toLowerCase() ?? "";
      const submittedDate = request.created_at.slice(0, 10).toLowerCase();

      return (
        request.request_number.toLowerCase().includes(normalizedSearch) ||
        initiatorName.includes(normalizedSearch) ||
        typeName.includes(normalizedSearch) ||
        departmentName.includes(normalizedSearch) ||
        assignedDate.includes(normalizedSearch) ||
        submittedDate.includes(normalizedSearch)
      );
    });
  }, [
    assignedRows,
    dateRange,
    debouncedSearch,
    departmentFilter,
    names,
    workStatusFilter,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Assigned Work</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track approved work assigned specifically to you
          </p>
        </div>
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
            <Select value={workStatusFilter} onValueChange={setWorkStatusFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Work status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Work Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
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
              onChange={setDateRange}
              description="Filter assigned work by assigned date"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredRows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No assigned work matches your filters.
            </div>
          ) : (
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
                      Department
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Work Status
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Assigned On
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Submitted On
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRows.map((request) => (
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
                        <StatusBadge status={normalizeWorkStatus(request.work_status)} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {request.work_assigned_at
                          ? new Date(request.work_assigned_at).toLocaleDateString()
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(request.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
