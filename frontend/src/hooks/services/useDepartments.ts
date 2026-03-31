import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { useAuth } from '@/contexts/auth-hooks';
import { 
  CreateDepartmentRequest, 
  UpdateDepartmentRequest 
} from '../../services/types';

export const useDepartments = () => {
  const { hasPermission } = useAuth();
  
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => services.departments.list(),
    enabled: hasPermission('manage_departments'),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useDepartment = (id: string) => {
  const { hasPermission } = useAuth();
  
  return useQuery({
    queryKey: ['departments', id],
    queryFn: () => services.departments.get(id),
    enabled: !!id && hasPermission('manage_departments'),
  });
};

export const useCreateDepartment = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: (data: CreateDepartmentRequest) => {
      if (!hasPermission('manage_departments')) {
        throw new Error('You do not have permission to manage departments');
      }
      return services.departments.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });
};

export const useUpdateDepartment = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDepartmentRequest }) => {
      if (!hasPermission('manage_departments')) {
        throw new Error('You do not have permission to manage departments');
      }
      return services.departments.update(id, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      queryClient.invalidateQueries({ queryKey: ['departments', id] });
    },
  });
};

export const useDeleteDepartment = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: (id: string) => {
      if (!hasPermission('manage_departments')) {
        throw new Error('You do not have permission to manage departments');
      }
      return services.departments.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });
};
