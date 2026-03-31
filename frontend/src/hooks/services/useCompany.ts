import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { UpdateCompanySettingsRequest } from '../../services/types';

export const useCompanySettings = () => {
  return useQuery({
    queryKey: ['company', 'settings'],
    queryFn: () => services.company.get(),
    staleTime: 15 * 60 * 1000, // 15 minutes
  });
};

export const useUpdateCompanySettings = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: UpdateCompanySettingsRequest) => 
      services.company.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company', 'settings'] });
    },
  });
};
