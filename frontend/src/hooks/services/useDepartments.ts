import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { 
  CreateDepartmentRequest, 
  UpdateDepartmentRequest 
} from '../../services/types';

export const useDepartments = () => {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => services.departments.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useDepartment = (id: string) => {
  return useQuery({
    queryKey: ['departments', id],
    queryFn: () => services.departments.get(id),
    enabled: !!id,
  });
};

export const useCreateDepartment = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateDepartmentRequest) => 
      services.departments.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });
};

export const useUpdateDepartment = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDepartmentRequest }) => 
      services.departments.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      queryClient.invalidateQueries({ queryKey: ['departments', id] });
    },
  });
};

export const useDeleteDepartment = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => services.departments.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });
};
