// Service exports
export { BaseService } from './base/BaseService';

// Individual service exports
export { AuthService } from './auth/AuthService';
export { DepartmentService } from './departments/DepartmentService';
export { RoleService } from './roles/RoleService';
export { ApprovalTypeService } from './approvalTypes/ApprovalTypeService';
export { ApprovalChainService } from './approvalChains/ApprovalChainService';
export { ApprovalRequestService } from './approvalRequests/ApprovalRequestService';
export { ProfileService } from './profiles/ProfileService';
export { AdminService } from './admin/AdminService';
export { CompanyService } from './company/CompanyService';
export { AuditService } from './audit/AuditService';
export { RequestAttachmentService } from './requestAttachments/RequestAttachmentService';

// Type exports
export * from './types';

// Service instances
import { AuthService } from './auth/AuthService';
import { DepartmentService } from './departments/DepartmentService';
import { RoleService } from './roles/RoleService';
import { ApprovalTypeService } from './approvalTypes/ApprovalTypeService';
import { ApprovalChainService } from './approvalChains/ApprovalChainService';
import { ApprovalRequestService } from './approvalRequests/ApprovalRequestService';
import { ProfileService } from './profiles/ProfileService';
import { AdminService } from './admin/AdminService';
import { CompanyService } from './company/CompanyService';
import { AuditService } from './audit/AuditService';
import { RequestAttachmentService } from './requestAttachments/RequestAttachmentService';

export const services = {
  auth: new AuthService(),
  departments: new DepartmentService(),
  roles: new RoleService(),
  approvalTypes: new ApprovalTypeService(),
  approvalChains: new ApprovalChainService(),
  approvalRequests: new ApprovalRequestService(),
  profiles: new ProfileService(),
  admin: new AdminService(),
  company: new CompanyService(),
  audit: new AuditService(),
  requestAttachments: new RequestAttachmentService(),
} as const;
