// Centralized query keys for React Query cache invalidation
export const QUERY_KEYS = {
  APPROVAL_REQUESTS: 'approval-requests' as const,
  PROFILE_NAMES: 'profile-names' as const,
  REQUEST_DETAIL: (id: string) => ['approval-requests', id] as const,
  REQUEST_ATTACHMENTS: (requestId: string) => ['approval-requests', requestId, 'attachments'] as const,
} as const;
