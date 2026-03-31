import { useQuery } from '@tanstack/react-query';
import { services } from '../../services';

export const useAuditLogs = () => {
  return useQuery({
    queryKey: ['audit', 'logs'],
    queryFn: () => services.audit.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // Auto-refresh every 10 minutes
  });
};
