import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { 
  CreateApprovalChainRequest, 
  UpdateApprovalChainRequest 
} from '../../services/types';

export const useApprovalChains = () => {
  return useQuery({
    queryKey: ['approval-chains'],
    queryFn: () => services.approvalChains.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useApprovalChain = (id: string) => {
  return useQuery({
    queryKey: ['approval-chains', id],
    queryFn: () => services.approvalChains.get(id),
    enabled: !!id,
  });
};

export const useCreateApprovalChain = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateApprovalChainRequest) => 
      services.approvalChains.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-chains'] });
    },
  });
};

export const useUpdateApprovalChain = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApprovalChainRequest }) => 
      services.approvalChains.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['approval-chains'] });
      queryClient.invalidateQueries({ queryKey: ['approval-chains', id] });
    },
  });
};

export const useDeleteApprovalChain = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => services.approvalChains.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-chains'] });
    },
  });
};
