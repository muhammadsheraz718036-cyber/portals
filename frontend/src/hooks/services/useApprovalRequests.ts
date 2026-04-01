import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from "@/constants/query-keys";
import { services } from '../../services';
import { toast } from 'sonner';
import { 
  CreateApprovalRequestRequest, 
  UpdateApprovalRequestRequest,
  ApprovalActionRequest
} from '../../services/types';

export const useApprovalRequests = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.APPROVAL_REQUESTS],
    queryFn: () => services.approvalRequests.list(),
    staleTime: 2 * 60 * 1000, // 2 minutes - more frequent updates
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
};

export const useApprovalRequest = (id: string) => {
  return useQuery({
    queryKey: QUERY_KEYS.REQUEST_DETAIL(id),
    queryFn: () => services.approvalRequests.get(id),
    enabled: !!id,
    staleTime: 1 * 60 * 1000, // 1 minute - very fresh data for individual requests
  });
};

export const useCreateApprovalRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateApprovalRequestRequest) => 
      services.approvalRequests.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      toast.success('Request created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create request');
    },
  });
};

export const useUpdateApprovalRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApprovalRequestRequest }) => 
      services.approvalRequests.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      toast.success('Request updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update request');
    },
  });
};

export const useApproveRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      services.approvalRequests.approve(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      toast.success('Request approved successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to approve request');
    },
  });
};

export const useRejectRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      services.approvalRequests.reject(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      toast.success('Request rejected successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reject request');
    },
  });
};

export const useRequestChanges = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      services.approvalRequests.requestChanges(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
      toast.success('Changes requested successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to request changes');
    },
  });
};

export const useResolveRequestNumber = () => {
  return useMutation({
    mutationFn: (requestNumber: string) => 
      services.approvalRequests.resolveRequestNumber(requestNumber),
  });
};
