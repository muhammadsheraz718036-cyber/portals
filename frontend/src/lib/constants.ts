/** Matches `approval_requests.status` in the database */
export type RequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "in_progress"
  | "changes_requested";

/** Catalog of permission keys stored in `roles.permissions` (labels for admin UI). */
export const allPermissions = [
  {
    id: "initiate_request",
    label: "Initiate Requests",
    description: "Can create new approval requests",
  },
  {
    id: "view_own_requests",
    label: "View Own Requests",
    description: "Can view their own submitted requests",
  },
  {
    id: "approve_reject",
    label: "Approve / Reject",
    description: "Can approve or reject requests in their queue",
  },
  {
    id: "view_department_requests",
    label: "View Department Requests",
    description: "Can view all requests from their department",
  },
  {
    id: "view_all_requests",
    label: "View All Requests",
    description: "Can view all requests across departments",
  },
  {
    id: "manage_users",
    label: "Manage Users",
    description: "Can create and manage user accounts",
  },
  {
    id: "manage_roles",
    label: "Manage Roles",
    description: "Can create and modify roles and permissions",
  },
  {
    id: "manage_departments",
    label: "Manage Departments",
    description: "Can create and modify departments",
  },
  {
    id: "manage_approval_types",
    label: "Manage Approval Types",
    description: "Can create and modify approval types and forms",
  },
  {
    id: "manage_chains",
    label: "Manage Approval Chains",
    description: "Can create and modify approval chains",
  },
  {
    id: "view_audit_logs",
    label: "View Audit Logs",
    description: "Can view system audit logs",
  },
] as const;

export type ApprovalFormField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  group?: string; // Field group for organizing into separate sections
};

export type ApprovalTypeRow = {
  id: string;
  name: string;
  description: string | null;
  fields: ApprovalFormField[];
  page_layout?: string;
};

export type ChainStep = {
  order: number;
  roleName: string;
  action: string;
};

export type ChainRow = {
  id: string;
  name: string;
  approval_type_id: string | null;
  steps: ChainStep[];
};

export type Role = {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
};
