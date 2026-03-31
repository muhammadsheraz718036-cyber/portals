import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { 
  CreateApprovalTypeRequest, 
  UpdateApprovalTypeRequest 
} from '../../services/types';

export const useApprovalTypes = () => {
  return useQuery({
    queryKey: ['approval-types'],
    queryFn: () => services.approvalTypes.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useApprovalType = (id: string) => {
  return useQuery({
    queryKey: ['approval-types', id],
    queryFn: () => services.approvalTypes.get(id),
    enabled: !!id,
  });
};

export const useCreateApprovalType = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateApprovalTypeRequest) => 
      services.approvalTypes.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-types'] });
    },
  });
};

export const useUpdateApprovalType = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateApprovalTypeRequest }) => 
      services.approvalTypes.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['approval-types'] });
      queryClient.invalidateQueries({ queryKey: ['approval-types', id] });
    },
  });
};

export const useDeleteApprovalType = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => services.approvalTypes.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approval-types'] });
    },
  });
};
