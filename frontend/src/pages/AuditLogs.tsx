import { useState } from "react";
import { Search, Filter, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/auth-hooks";
import { useAuditLogs } from "@/hooks/services";

type AuditLogRow = {
  id: string;
  user_id?: string | null;
  user_name: string;
  action: string;
  target: string;
  details: string | null;
  category: string;
  status: string;
  entity_type?: string | null;
  entity_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  http_method?: string | null;
  route_path?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
};

function formatMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata || Object.keys(metadata).length === 0) return "No additional metadata";
  return JSON.stringify(metadata, null, 2);
}

export default function AuditLogs() {
  const { isAdmin, hasPermission } = useAuth();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [selectedLog, setSelectedLog] = useState<AuditLogRow | null>(null);
  const hasAuditAccess =
    isAdmin || hasPermission("view_audit_logs") || hasPermission("all");
  const { data: logs = [], isLoading: loading } = useAuditLogs();

  const actions = [...new Set(logs.map((l) => l.action))];

  const filtered = logs.filter((log) => {
    if (actionFilter !== "all" && log.action !== actionFilter) return false;
    const d = (log.details ?? "").toLowerCase();
    if (
      search &&
      !log.user_name.toLowerCase().includes(search.toLowerCase()) &&
      !log.category.toLowerCase().includes(search.toLowerCase()) &&
      !log.status.toLowerCase().includes(search.toLowerCase()) &&
      !log.target.toLowerCase().includes(search.toLowerCase()) &&
      !(log.route_path ?? "").toLowerCase().includes(search.toLowerCase()) &&
      !d.includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  if (!hasAuditAccess) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            You do not have permission to view audit logs.
          </p>
        </div>
      </div>
    );
  }

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
        <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete activity history, who did what and when
        </p>
      </div>

      <Card className="border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[200px]">
                <Filter className="h-3.5 w-3.5 mr-2" />
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
                    Timestamp
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
                    User
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
                    Action
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
                    Category
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
                    Target
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide whitespace-nowrap">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-muted/30 cursor-pointer transition-snappy"
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium">{log.user_name}</td>
                    <td className="px-4 py-3">{log.action}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline" className="whitespace-nowrap">
                        {log.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge
                        variant={log.status === "FAILURE" ? "destructive" : "secondary"}
                        className="whitespace-nowrap"
                      >
                        {log.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-primary font-medium">
                      {log.target}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="px-4 py-12 text-center text-muted-foreground text-sm">
                No audit entries found
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <SheetContent className="animate-slide-in-right">
          <SheetHeader>
            <SheetTitle>Log Detail</SheetTitle>
          </SheetHeader>
          {selectedLog && (
            <div className="mt-6 space-y-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Timestamp
                </p>
                <p className="font-medium">
                  {new Date(selectedLog.created_at).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  User
                </p>
                <p className="font-medium">{selectedLog.user_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Action
                </p>
                <p className="font-medium">{selectedLog.action}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Category
                </p>
                <Badge variant="outline" className="whitespace-nowrap">
                  {selectedLog.category}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Status
                </p>
                <Badge
                  variant={
                    selectedLog.status === "FAILURE" ? "destructive" : "secondary"
                  }
                  className="whitespace-nowrap"
                >
                  {selectedLog.status}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Target
                </p>
                <p className="font-medium text-primary">{selectedLog.target}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Details
                </p>
                <p className="font-medium">{selectedLog.details}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Route
                </p>
                <p className="font-medium">
                  {[selectedLog.http_method, selectedLog.route_path].filter(Boolean).join(" ")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Source
                </p>
                <p className="font-medium break-all">
                  {selectedLog.ip_address ?? "Unknown IP"}
                </p>
                <p className="text-xs text-muted-foreground break-all mt-1">
                  {selectedLog.user_agent ?? "Unknown user agent"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Entity
                </p>
                <p className="font-medium">
                  {[selectedLog.entity_type, selectedLog.entity_id].filter(Boolean).join(": ") ||
                    "Not specified"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Metadata
                </p>
                <pre className="rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-all overflow-x-auto">
                  {formatMetadata(selectedLog.metadata)}
                </pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
