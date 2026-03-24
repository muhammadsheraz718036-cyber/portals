import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/constants";

const statusConfig: Record<RequestStatus | string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-warning/10 text-warning border-warning/20" },
  in_progress: { label: "In Progress", className: "bg-primary/10 text-primary border-primary/20" },
  approved: { label: "Approved", className: "bg-success/10 text-success border-success/20" },
  rejected: { label: "Rejected", className: "bg-destructive/10 text-destructive border-destructive/20" },
  changes_requested: { label: "Changes Requested", className: "bg-warning/10 text-warning border-warning/20" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.pending;
  return (
    <Badge variant="outline" className={`${config.className} font-medium text-xs`}>
      {config.label}
    </Badge>
  );
}
