import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
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
  });
};

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: UpdateProfileRequest) => 
      services.auth.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
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
