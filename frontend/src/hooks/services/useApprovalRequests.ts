import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from "@/constants/query-keys";
import { api } from "@/lib/api";
import { 
  CreateApprovalRequestRequest, 
  UpdateApprovalRequestRequest,
  ApprovalActionRequest
} from '../../services/types';

export const useApprovalRequests = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.APPROVAL_REQUESTS],
    queryFn: () => api.approvalRequests.list(),
    staleTime: 2 * 60 * 1000, // 2 minutes - more frequent updates
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
};

export const useApprovalRequest = (id: string) => {
  return useQuery({
    queryKey: QUERY_KEYS.REQUEST_DETAIL(id),
    queryFn: () => api.approvalRequests.get(id),
    enabled: !!id,
    staleTime: 1 * 60 * 1000, // 1 minute - very fresh data for individual requests
  });
};

export const useCreateApprovalRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateApprovalRequestRequest) => 
      api.approvalRequests.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
    },
  });
};

export const useUpdateApprovalRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApprovalRequestRequest }) => 
      api.approvalRequests.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
    },
  });
};

export const useApproveRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      api.approvalRequests.approve(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
    },
  });
};

export const useRejectRequest = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      api.approvalRequests.reject(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
    },
  });
};

export const useRequestChanges = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: ApprovalActionRequest }) => 
      api.approvalRequests.requestChanges(id, data || {}),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.APPROVAL_REQUESTS] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.REQUEST_DETAIL(id) });
    },
  });
};

export const useResolveRequestNumber = () => {
  return useMutation({
    mutationFn: (requestNumber: string) => 
      api.approvalRequests.resolveNumber(requestNumber),
  });
};
