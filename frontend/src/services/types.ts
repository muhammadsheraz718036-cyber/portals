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
  phone_number: string | null;
  landline_number: string | null;
  contact_department: string | null;
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
  allow_attachments?: boolean;
  pre_salutation?: string;
  post_salutation?: string;
  department_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateApprovalTypeRequest {
  name: string;
  description?: string;
  fields: unknown[];
  page_layout?: string;
  pre_salutation?: string | null;
  post_salutation?: string | null;
  allow_attachments?: boolean;
  department_id?: string | null;
}

export interface UpdateApprovalTypeRequest {
  name?: string;
  description?: string;
  fields?: unknown[];
  page_layout?: string;
  pre_salutation?: string | null;
  post_salutation?: string | null;
  allow_attachments?: boolean;
  department_id?: string | null;
}

export interface ApprovalTypeAttachment {
  id: string;
  approval_type_id: string;
  field_name: string;
  label: string;
  required: boolean;
  max_file_size_mb: number;
  allowed_extensions: string[];
  max_files: number;
  created_at?: string;
  updated_at?: string;
}

export interface RequestAttachment {
  id: string;
  request_id: string;
  approval_type_attachment_id: string;
  field_name: string;
  field_label?: string;
  original_filename: string;
  stored_filename: string;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  uploaded_by: string;
  created_at?: string;
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
  has_attachments?: boolean;
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

export interface CreateApprovalTypeAttachmentRequest {
  field_name: string;
  label: string;
  required?: boolean;
  max_file_size_mb?: number;
  allowed_extensions?: string[];
  max_files?: number;
}

export interface UpdateApprovalTypeAttachmentRequest {
  label?: string;
  required?: boolean;
  max_file_size_mb?: number;
  allowed_extensions?: string[];
  max_files?: number;
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
  phone_number?: string | null;
  landline_number?: string | null;
  contact_department?: string | null;
}
