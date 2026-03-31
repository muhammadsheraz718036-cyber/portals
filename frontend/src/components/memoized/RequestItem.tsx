import React from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import type { RequestStatus } from '@/lib/constants';

interface RequestItemProps {
  request: {
    id: string;
    request_number: string;
    status: RequestStatus;
    current_step: number;
    total_steps: number;
    created_at: string;
    approval_types: { name: string } | null;
    initiator_name?: string;
  };
  onClick: () => void;
}

// Memoized request item to prevent unnecessary re-renders
export const RequestItem = React.memo<RequestItemProps>(({ request, onClick }) => {
  return (
    <div
      className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-snappy"
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{request.request_number}</span>
          <StatusBadge status={request.status} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {request.approval_types?.name || "—"}
        </p>
      </div>
      <div className="text-xs text-muted-foreground">
        Step {request.current_step}/{request.total_steps}
      </div>
    </div>
  );
});

RequestItem.displayName = 'RequestItem';
