import { useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { useAuth } from '@/contexts/auth-hooks';
import { 
  CreateUserRequest, 
  UpdateUserRequest 
} from '../../services/types';

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: (data: CreateUserRequest) => {
      if (!hasPermission('manage_users')) {
        throw new Error('You do not have permission to manage users');
      }
      return services.admin.createUser(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: UpdateUserRequest }) => {
      if (!hasPermission('manage_users')) {
        throw new Error('You do not have permission to manage users');
      }
      return services.admin.updateUser(userId, data);
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['profiles', userId] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }); // In case updating current user
    },
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: (userId: string) => {
      if (!hasPermission('manage_users')) {
        throw new Error('You do not have permission to manage users');
      }
      return services.admin.deleteUser(userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
};

export const useResetUserPassword = () => {
  const { hasPermission } = useAuth();
  
  return useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      if (!hasPermission('manage_users')) {
        throw new Error('You do not have permission to manage users');
      }
      return services.admin.resetUserPassword(userId, newPassword);
    },
  });
};
