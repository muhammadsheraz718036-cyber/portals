import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { useAuth } from '@/contexts/auth-hooks';
import { toast } from 'sonner';
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

// Hook for regular users to get departments (no management permissions required)
export const useDepartmentsForUsers = () => {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['departments', 'user'],
    queryFn: () => services.departments.list(),
    enabled: !!user, // Only enabled if user is authenticated
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
      toast.success('Department created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create department');
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
      toast.success('Department updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update department');
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
      toast.success('Department deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete department');
    },
  });
};

// Department Managers
export const useDepartmentManagers = (departmentId: string) => {
  const { hasPermission } = useAuth();
  
  return useQuery({
    queryKey: ['departments', departmentId, 'managers'],
    queryFn: () => services.departments.getManagers(departmentId),
    enabled: !!departmentId && hasPermission('manage_departments'),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
};

export const useAddDepartmentManager = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: ({ departmentId, userId }: { departmentId: string; userId: string }) => {
      if (!hasPermission('manage_departments')) {
        throw new Error('You do not have permission to manage departments');
      }
      return services.departments.addManager(departmentId, userId);
    },
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: ['departments', departmentId, 'managers'] });
      toast.success('Manager assigned successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to assign manager');
    },
  });
};

export const useRemoveDepartmentManager = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: ({ departmentId, userId }: { departmentId: string; userId: string }) => {
      if (!hasPermission('manage_departments')) {
        throw new Error('You do not have permission to manage departments');
      }
      return services.departments.removeManager(departmentId, userId);
    },
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: ['departments', departmentId, 'managers'] });
      toast.success('Manager removed successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove manager');
    },
  });
};
