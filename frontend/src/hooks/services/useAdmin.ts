import { useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { useAuth } from '@/contexts/auth-hooks';
import { toast } from 'sonner';
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
      toast.success('User created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create user');
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
      toast.success('User updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update user');
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
      toast.success('User deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete user');
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
    onSuccess: () => {
      toast.success('Password reset successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reset password');
    },
  });
};
