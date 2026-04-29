export interface Profile {
  id: string;
  full_name: string;
  email: string;
  signature_url?: string | null;
  department_id: string | null;
  department_ids: string[];
  department_names?: string[];
  role_id: string | null;
  role_ids: string[];
  role_names?: string[];
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
  attachment_fields?: CreateApprovalTypeAttachmentRequest[];
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
  attachment_fields?: Array<CreateApprovalTypeAttachmentRequest & { id?: string }>;
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
  template_original_filename?: string | null;
  template_stored_filename?: string | null;
  template_file_size_bytes?: number | null;
  template_mime_type?: string | null;
  template_uploaded_at?: string | null;
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
  work_assignee_id?: string | null;
  steps: Array<{
    step_order: number;
    name: string;
    role: string;
    scope_type: "initiator_department" | "fixed_department" | "static" | "expression";
    scope_value?: string | null;
    action_label: string;
  }>;
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
  work_status?: "pending" | "assigned" | "in_progress" | "done" | "not_done";
  request_number?: string;
  initiator?: { full_name: string; signature_url?: string | null };
  approval_types?: unknown;
  departments?: unknown;
  has_attachments?: boolean;
  work_assignee_id?: string | null;
  work_assigned_by?: string | null;
  work_assigned_at?: string | null;
  work_completed_by?: string | null;
  work_completed_at?: string | null;
  work_assignee?: {
    id: string | null;
    full_name: string | null;
    email?: string | null;
  } | null;
  work_completed_by_profile?: {
    id: string | null;
    full_name: string | null;
  } | null;
  final_authority_user_id?: string | null;
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
  user_id?: string | null;
  user_name: string;
  action: string;
  target: string;
  details: string | null;
  category: string;
  status: string;
  entity_type?: string | null;
  entity_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  http_method?: string | null;
  route_path?: string | null;
  metadata?: Record<string, unknown>;
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
  work_assignee_id?: string | null;
  steps: ApprovalChain["steps"];
}

export interface UpdateApprovalChainRequest {
  name?: string;
  approval_type_id?: string;
  work_assignee_id?: string | null;
  steps?: ApprovalChain["steps"];
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
  comment?: string;
}

export interface ApprovalActionRequest {
  comment?: string;
}

export interface RejectApprovalActionRequest {
  comment: string;
}

export interface WorkAssigneeOption {
  id: string;
  full_name: string;
  email: string;
  department_name?: string | null;
  department_names?: string[];
  role_names?: string[];
}

export interface CreateUserRequest {
  email: string;
  password: string;
  full_name: string;
  signature_url?: string | null;
  department_id?: string | null;
  department_ids?: string[];
  role_id?: string | null;
  role_ids?: string[];
  is_admin?: boolean;
}

export interface UpdateUserRequest {
  email?: string;
  full_name?: string;
  signature_url?: string | null;
  department_id?: string | null;
  department_ids?: string[];
  role_id?: string | null;
  role_ids?: string[];
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
  signature_url?: string | null;
}

export interface UpdateCompanySettingsRequest {
  company_name?: string;
  logo_url?: string | null;
  phone_number?: string | null;
  landline_number?: string | null;
  contact_department?: string | null;
}
