import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { useAuth } from '@/contexts/auth-hooks';
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
    },
  });
};
