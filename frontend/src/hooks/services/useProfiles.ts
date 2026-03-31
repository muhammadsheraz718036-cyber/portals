import { useQuery, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';

export const useProfiles = () => {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => services.profiles.list(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
};

export const useProfile = (id: string) => {
  return useQuery({
    queryKey: ['profiles', id],
    queryFn: () => services.profiles.get(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useProfileNames = (ids: string[]) => {
  return useQuery({
    queryKey: ['profiles', 'names', ids],
    queryFn: () => services.profiles.lookupNames(ids),
    enabled: ids.length > 0,
    staleTime: 15 * 60 * 1000, // 15 minutes
  });
};
