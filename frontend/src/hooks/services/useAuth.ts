import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { toast } from 'sonner';
import { 
  LoginRequest, 
  SetupRequest, 
  UpdatePasswordRequest,
  UpdateProfileRequest 
} from '../../services/types';

// Auth hooks
export const useLogin = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (credentials: LoginRequest) => 
      services.auth.login(credentials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });
};

export const useSetup = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: SetupRequest) => 
      services.auth.setup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });
};

export const useAuthMe = () => {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => services.auth.getMe(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useUpdatePassword = () => {
  return useMutation({
    mutationFn: (data: UpdatePasswordRequest) => 
      services.auth.updatePassword(data),
    onSuccess: () => {
      toast.success('Password updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update password');
    },
  });
};

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: UpdateProfileRequest) => 
      services.auth.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      toast.success('Profile updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update profile');
    },
  });
};

export const useSetupStatus = () => {
  return useQuery({
    queryKey: ['auth', 'setup-status'],
    queryFn: () => services.auth.getSetupStatus(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
};
