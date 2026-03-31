import { useQuery } from '@tanstack/react-query';
import { services } from '../../services';
import { useAuth } from '@/contexts/auth-hooks';

export const useAuditLogs = () => {
  const { hasPermission } = useAuth();
  
  return useQuery({
    queryKey: ['audit', 'logs'],
    queryFn: () => services.audit.list(),
    enabled: hasPermission('view_audit_logs'),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // Auto-refresh every 10 minutes
  });
};
