import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { 
  CreateApprovalRequestRequest, 
  UpdateApprovalRequestRequest,
  ApprovalActionRequest
} from '../../services/types';

export const useApprovalRequests = () => {
  return useQuery({
    queryKey: ['approval-requests'],
    queryFn: () => services.approvalRequests.list(),
    staleTime: 2 * 60 * 1000, // 2 minutes - more frequent updates
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
};

export const useApprovalRequest = (id: string) => {
  return useQuery({
    queryKey: ['approval-requests', id],
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
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
    },
  });
};

export const useUpdateApprovalRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApprovalRequestRequest }) => 
      services.approvalRequests.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approval-requests', id] });
    },
  });
};

export const useApproveRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      services.approvalRequests.approve(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approval-requests', id] });
    },
  });
};

export const useRejectRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      services.approvalRequests.reject(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approval-requests', id] });
    },
  });
};

export const useRequestChanges = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      services.approvalRequests.requestChanges(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approval-requests', id] });
    },
  });
};

export const useResolveRequestNumber = () => {
  return useMutation({
    mutationFn: (requestNumber: string) => 
      services.approvalRequests.resolveNumber(requestNumber),
  });
};
