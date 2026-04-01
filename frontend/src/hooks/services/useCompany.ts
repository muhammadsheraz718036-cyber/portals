import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { toast } from 'sonner';
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
      toast.success('Company settings updated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update company settings');
    },
  });
};
