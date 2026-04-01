import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { useAuth } from '@/contexts/auth-hooks';
import { toast } from 'sonner';
import { 
  CreateApprovalChainRequest, 
  UpdateApprovalChainRequest 
} from '../../services/types';

export const useApprovalChains = () => {
  const { hasPermission } = useAuth();
  
  return useQuery({
    queryKey: ['approval-chains'],
    queryFn: () => services.approvalChains.list(),
    enabled:
      hasPermission('manage_chains') ||
      hasPermission('initiate_request'),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useApprovalChain = (id: string) => {
  const { hasPermission } = useAuth();
  
  return useQuery({
    queryKey: ['approval-chains', id],
    queryFn: () => services.approvalChains.get(id),
    enabled: !!id && hasPermission('manage_chains'),
  });
};

export const useCreateApprovalChain = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: (data: CreateApprovalChainRequest) => {
      if (!hasPermission('manage_chains')) {
        throw new Error('You do not have permission to manage approval chains');
      }
      return services.approvalChains.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-chains'] });
      toast.success('Approval chain created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create approval chain');
    },
  });
};

export const useUpdateApprovalChain = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApprovalChainRequest }) => {
      if (!hasPermission('manage_chains')) {
        throw new Error('You do not have permission to manage approval chains');
      }
      return services.approvalChains.update(id, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['approval-chains'] });
      queryClient.invalidateQueries({ queryKey: ['approval-chains', id] });
      toast.success('Approval chain updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update approval chain');
    },
  });
};

export const useDeleteApprovalChain = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: (id: string) => {
      if (!hasPermission('manage_chains')) {
        throw new Error('You do not have permission to manage approval chains');
      }
      return services.approvalChains.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-chains'] });
      toast.success('Approval chain deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete approval chain');
    },
  });
};
