import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { useAuth } from '@/contexts/auth-hooks';
import { toast } from 'sonner';
import { 
  CreateRoleRequest, 
  UpdateRoleRequest 
} from '../../services/types';

export const useRoles = () => {
  const { hasPermission } = useAuth();
  
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => services.roles.list(),
    enabled: hasPermission('manage_roles'),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useRole = (id: string) => {
  const { hasPermission } = useAuth();
  
  return useQuery({
    queryKey: ['roles', id],
    queryFn: () => services.roles.get(id),
    enabled: !!id && hasPermission('manage_roles'),
  });
};

export const useCreateRole = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: (data: CreateRoleRequest) => {
      if (!hasPermission('manage_roles')) {
        throw new Error('You do not have permission to manage roles');
      }
      return services.roles.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create role');
    },
  });
};

export const useUpdateRole = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRoleRequest }) => {
      if (!hasPermission('manage_roles')) {
        throw new Error('You do not have permission to manage roles');
      }
      return services.roles.update(id, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['roles', id] });
      toast.success('Role updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update role');
    },
  });
};

export const useDeleteRole = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: (id: string) => {
      if (!hasPermission('manage_roles')) {
        throw new Error('You do not have permission to manage roles');
      }
      return services.roles.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete role');
    },
  });
};
