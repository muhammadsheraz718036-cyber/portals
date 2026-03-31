import { useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { 
  CreateUserRequest, 
  UpdateUserRequest 
} from '../../services/types';

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateUserRequest) => 
      services.admin.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: UpdateUserRequest }) => 
      services.admin.updateUser(userId, data),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['profiles', userId] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }); // In case updating current user
    },
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (userId: string) => services.admin.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
};

export const useResetUserPassword = () => {
  return useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) => 
      services.admin.resetUserPassword(userId, newPassword),
  });
};
