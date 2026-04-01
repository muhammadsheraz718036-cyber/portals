import { api } from './api';
import { useAuth } from '@/contexts/auth-hooks';

// Secure API wrapper that checks permissions before making requests
export const secureApi = {
  canViewRequests: (hasPermission: (permission: string) => boolean) =>
    hasPermission('view_own_requests') ||
    hasPermission('view_department_requests') ||
    hasPermission('view_all_requests'),

  // Approval requests - requires 'initiate_request' permission
  approvalRequests: {
    list: () => {
      const { hasPermission } = useAuth();
      if (!secureApi.canViewRequests(hasPermission)) {
        throw new Error('Unauthorized: You do not have permission to view approval requests');
      }
      return api.approvalRequests.list();
    },
    get: (id: string) => {
      const { hasPermission } = useAuth();
      if (!secureApi.canViewRequests(hasPermission)) {
        throw new Error('Unauthorized: You do not have permission to view this request');
      }
      return api.approvalRequests.get(id);
    },
    create: (data: any) => {
      const { hasPermission } = useAuth();
      if (!hasPermission('initiate_request')) {
        throw new Error('Unauthorized: You do not have permission to create requests');
      }
      return api.approvalRequests.create(data);
    },
    approve: (id: string, data: any) => {
      const { hasPermission } = useAuth();
      if (!hasPermission('approve_reject')) {
        throw new Error('Unauthorized: You do not have permission to approve requests');
      }
      return api.approvalRequests.approve(id, data);
    },
    reject: (id: string, data: any) => {
      const { hasPermission } = useAuth();
      if (!hasPermission('approve_reject')) {
        throw new Error('Unauthorized: You do not have permission to reject requests');
      }
      return api.approvalRequests.reject(id, data);
    },
    update: (id: string, data: any) => {
      const { hasPermission } = useAuth();
      if (!secureApi.canViewRequests(hasPermission)) {
        throw new Error('Unauthorized: You do not have permission to update this request');
      }
      return api.approvalRequests.update(id, data);
    },
  },

  // Admin functions - require admin permissions
  admin: {
    users: {
      list: () => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_users')) {
          throw new Error('Unauthorized: You do not have permission to manage users');
        }
        return api.admin.users.list();
      },
      create: (data: any) => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_users')) {
          throw new Error('Unauthorized: You do not have permission to create users');
        }
        return api.admin.users.create(data);
      },
      update: (id: string, data: any) => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_users')) {
          throw new Error('Unauthorized: You do not have permission to update users');
        }
        return api.admin.users.update(id, data);
      },
      delete: (id: string) => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_users')) {
          throw new Error('Unauthorized: You do not have permission to delete users');
        }
        return api.admin.users.delete(id);
      },
    },
    roles: {
      list: () => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_roles')) {
          throw new Error('Unauthorized: You do not have permission to manage roles');
        }
        return api.admin.roles.list();
      },
      create: (data: any) => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_roles')) {
          throw new Error('Unauthorized: You do not have permission to create roles');
        }
        return api.admin.roles.create(data);
      },
    },
    approvalTypes: {
      list: () => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_approval_types')) {
          throw new Error('Unauthorized: You do not have permission to manage approval types');
        }
        return api.admin.approvalTypes.list();
      },
      create: (data: any) => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_approval_types')) {
          throw new Error('Unauthorized: You do not have permission to create approval types');
        }
        return api.admin.approvalTypes.create(data);
      },
      update: (id: string, data: any) => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_approval_types')) {
          throw new Error('Unauthorized: You do not have permission to update approval types');
        }
        return api.admin.approvalTypes.update(id, data);
      },
      delete: (id: string) => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_approval_types')) {
          throw new Error('Unauthorized: You do not have permission to delete approval types');
        }
        return api.admin.approvalTypes.delete(id);
      },
    },
    chains: {
      list: () => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_chains')) {
          throw new Error('Unauthorized: You do not have permission to manage approval chains');
        }
        return api.admin.chains.list();
      },
      create: (data: any) => {
        const { hasPermission } = useAuth();
        if (!hasPermission('manage_chains')) {
          throw new Error('Unauthorized: You do not have permission to create approval chains');
        }
        return api.admin.chains.create(data);
      },
    },
    auditLogs: {
      list: () => {
        const { hasPermission } = useAuth();
        if (!hasPermission('view_audit_logs')) {
          throw new Error('Unauthorized: You do not have permission to view audit logs');
        }
        return api.auditLogs.list();
      },
    },
  },
};
