export interface Profile {
  id: string;
  full_name: string;
  email: string;
  department_id: string | null;
  role_id: string | null;
  is_admin: boolean;
  is_active: boolean;
  permissions: string[];
  created_at?: string;
  updated_at?: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  profile: Profile;
}

export interface SetupRequest {
  email: string;
  password: string;
  full_name: string;
}

export interface CompanySettings {
  id: string;
  company_name: string;
  logo_url: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface Department {
  id: string;
  name: string;
  head_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ApprovalType {
  id: string;
  name: string;
  description?: string;
  fields: unknown[];
  page_layout?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ApprovalChain {
  id: string;
  name: string;
  approval_type_id: string;
  steps: unknown[];
  created_at?: string;
  updated_at?: string;
}

export interface ApprovalRequest {
  id: string;
  approval_type_id: string;
  approval_chain_id?: string | null;
  department_id?: string | null;
  form_data: Record<string, unknown>;
  current_step: number;
  total_steps: number;
  status: string;
  request_number?: string;
  initiator?: { full_name: string };
  approval_types?: unknown;
  departments?: unknown;
  created_at?: string;
  updated_at?: string;
}

export interface ApprovalRequestAction {
  id: string;
  request_id: string;
  action: string;
  comment?: string;
  actor_id: string;
  created_at?: string;
}

export interface AuditLog {
  id: string;
  user_name: string;
  action: string;
  target: string;
  details: string | null;
  created_at: string;
}

export interface CreateDepartmentRequest {
  name: string;
  head_name?: string | null;
}

export interface UpdateDepartmentRequest {
  name?: string;
  head_name?: string | null;
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  permissions?: string[];
}

export interface CreateApprovalTypeRequest {
  name: string;
  description?: string;
  fields: unknown[];
  page_layout?: string;
}

export interface UpdateApprovalTypeRequest {
  name?: string;
  description?: string;
  fields?: unknown[];
  page_layout?: string;
}

export interface CreateApprovalChainRequest {
  name: string;
  approval_type_id: string;
  steps: unknown[];
}

export interface UpdateApprovalChainRequest {
  name?: string;
  approval_type_id?: string;
  steps?: unknown[];
}

export interface CreateApprovalRequestRequest {
  approval_type_id: string;
  approval_chain_id?: string | null;
  department_id?: string | null;
  form_data: Record<string, unknown>;
  current_step: number;
  total_steps: number;
  status: string;
}

export interface UpdateApprovalRequestRequest {
  form_data: Record<string, unknown>;
}

export interface ApprovalActionRequest {
  comment?: string;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  full_name: string;
  department_id?: string | null;
  role_id?: string | null;
  is_admin?: boolean;
}

export interface UpdateUserRequest {
  full_name?: string;
  department_id?: string | null;
  role_id?: string | null;
  is_admin?: boolean;
  is_active?: boolean;
  unlock_account?: boolean;
}

export interface UpdatePasswordRequest {
  new_password: string;
  current_password?: string;
}

export interface UpdateProfileRequest {
  full_name: string;
}

export interface UpdateCompanySettingsRequest {
  company_name?: string;
  logo_url?: string | null;
}
