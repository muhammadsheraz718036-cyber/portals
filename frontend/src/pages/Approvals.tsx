import { useEffect, useMemo, useState } from "react";
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
import { useApprovalRequests, useProfileNames } from "@/hooks/services";
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

export default function Approvals() {
  const navigate = useNavigate();
  const { user, isAdmin, hasPermission } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  
  // Debounce search to prevent excessive re-renders
  const debouncedSearch = useDebounce(search, 300);

  const { data: rows = [], isLoading: loading } = useApprovalRequests() as { data: RequestRow[], isLoading: boolean };

  const initiatorIds = useMemo(() => [...new Set(rows.map((r) => r.initiator_id))], [rows]);
  const { data: names = {} } = useProfileNames(initiatorIds);

  const segregated = useMemo(() => {
    const myRequests = rows.filter((r) => r.is_initiator);
    
    // Keep both pending approvals and requests the current user already acted on
    // in the approver-facing list so approval history remains accessible.
    const approvalRequests = rows.filter((r) => {
      if (!(r.needs_approval || r.has_acted)) return false;
      return isAdmin || hasPermission("approve_reject") || hasPermission("all");
    });
    
    const allOther = rows.filter(
      (r) => !r.is_initiator && !r.needs_approval && !r.has_acted,
    );
    return { myRequests, approvalRequests, allOther };
  }, [rows, isAdmin, hasPermission]);

  const filtered = useMemo(() => {
    const applyFilters = (list: RequestRow[]) =>
      list.filter((r) => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        const initiator = names[r.initiator_id] ?? "";
        const typeName = r.approval_types?.name ?? "";
        if (
          search &&
          !r.request_number.toLowerCase().includes(search.toLowerCase()) &&
          !typeName.toLowerCase().includes(search.toLowerCase()) &&
          !initiator.toLowerCase().includes(search.toLowerCase())
        ) {
          return false;
        }
        return true;
      });

    return {
      myRequests: applyFilters(segregated.myRequests),
      approvalRequests: applyFilters(segregated.approvalRequests),
      allOther: applyFilters(segregated.allOther),
    };
  }, [segregated, statusFilter, search, names]);

  const renderTable = (requests: RequestRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
              Request ID
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
              Type
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
              Initiator
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
              Department
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
              Status
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
              Progress
            </th>
            <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
              Date
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {requests.map((req) => (
            <tr
              key={req.id}
              className="hover:bg-muted/30 cursor-pointer transition-snappy"
              onClick={() => {
                console.log("Navigating to request ID:", req.id, "Number:", req.request_number);
                navigate(`/approvals/${req.id}`);
              }}
            >
              <td className="px-4 py-3 font-medium text-primary">
                {req.request_number}
              </td>
              <td className="px-4 py-3">{req.approval_types?.name ?? "—"}</td>
              <td className="px-4 py-3">{names[req.initiator_id] ?? "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {req.departments?.name ?? "—"}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={req.status} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{
                        width: `${req.total_steps ? (req.current_step / req.total_steps) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {req.current_step}/{req.total_steps}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground text-xs">
                {new Date(req.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
          {requests.length === 0 && (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-12 text-center text-muted-foreground"
              >
                No requests found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const renderGroupedTable = (requests: RequestRow[]) => {
    const grouped = requests.reduce(
      (acc, req) => {
        const dept = req.departments?.name ?? "No Department";
        if (!acc[dept]) acc[dept] = [];
        acc[dept].push(req);
        return acc;
      },
      {} as Record<string, RequestRow[]>,
    );

    return (
      <div className="space-y-6">
        {Object.entries(grouped).map(([dept, reqs]) => (
          <div key={dept}>
            <h3 className="text-lg font-semibold mb-3">{dept}</h3>
            {renderTable(reqs)}
          </div>
        ))}
        {requests.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            No requests found
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and manage approval requests
          </p>
        </div>
        <Button onClick={() => navigate("/approvals/new")} className="gap-2">
          <Plus className="h-4 w-4" />
          New Request
        </Button>
      </div>

      <Card className="border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, type, or initiator..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs defaultValue={isAdmin ? "approval" : "my"} className="w-full">
            <TabsList className="grid w-full grid-cols-2 lg:grid-cols-3">
              {isAdmin ? (
                <>
                  <TabsTrigger value="approval">
                    Requests to Approve
                  </TabsTrigger>
                  <TabsTrigger value="my">My Requests</TabsTrigger>
                  <TabsTrigger value="other">All Other Requests</TabsTrigger>
                </>
              ) : (
                <>
                  <TabsTrigger value="my">My Requests</TabsTrigger>
                  <TabsTrigger value="approval">
                    Requests to Approve
                  </TabsTrigger>
                </>
              )}
            </TabsList>
            <TabsContent value="my" className="mt-0">
              {renderTable(filtered.myRequests)}
            </TabsContent>
            <TabsContent value="approval" className="mt-0">
              {renderTable(filtered.approvalRequests)}
            </TabsContent>
            {isAdmin && (
              <TabsContent value="other" className="mt-0">
                {renderGroupedTable(filtered.allOther)}
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
