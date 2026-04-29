/**
 * HTTP client for approval-central-api (Express + Postgres).
 * In development, Vite proxies /api → backend.
 * In production, frontend and backend share the same origin.
 * Leave VITE_API_URL empty so API calls remain relative to /api.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? "";

function buildUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

const TOKEN_KEY = "ac_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  signature_url?: string | null;
  department_id: string | null;
  department_ids: string[];
  department_names: string[];
  role_id: string | null;
  role_ids: string[];
  role_names: string[];
  role_name: string | null;
  department_name: string | null;
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

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  request_id: string | null;
  request_number: string | null;
  actor_name: string | null;
}

async function request<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const token = init?.skipAuth ? null : getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(buildUrl(path), { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error ?? data?.message ?? res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
}

async function uploadForm<T>(path: string, formData: FormData): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers,
    body: formData,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error ?? data?.message ?? res.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export const api = {
  setup: {
    status: () =>
      request<{ hasUsers: boolean }>("/api/setup/status", { skipAuth: true }),
    complete: (body: { email: string; password: string; full_name: string }) =>
      request<{ token: string; user: AuthUser; profile: Profile }>(
        "/api/setup",
        {
          method: "POST",
          body: JSON.stringify(body),
          skipAuth: true,
        },
      ),
  },

  auth: {
    login: (body: { email: string; password: string }) =>
      request<{ token: string; user: AuthUser; profile: Profile }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify(body),
          skipAuth: true,
        },
      ),
    logout: () =>
      request<{ success: boolean }>("/api/auth/logout", {
        method: "POST",
      }),
    me: () => request<{ user: AuthUser; profile: Profile }>("/api/auth/me"),
    updatePassword: (body: {
      new_password: string;
      current_password?: string;
    }) =>
      request<{ success: boolean }>("/api/auth/me/password", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    updateProfile: (body: { full_name: string; signature_url?: string | null }) =>
      request<{ profile: Profile }>("/api/auth/me/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    uploadSignature: (file: File) => {
      const formData = new FormData();
      formData.append("signature", file);
      return uploadForm<{ profile: Profile }>("/api/auth/me/signature", formData);
    },
  },

  companySettings: {
    get: () =>
      request<{
        id: string;
        company_name: string;
        logo_url: string | null;
        phone_number: string | null;
        landline_number: string | null;
        updated_at: string;
        updated_by: string | null;
      } | null>("/api/company-settings", { skipAuth: true }),
    update: (body: {
      company_name?: string;
      logo_url?: string | null;
      phone_number?: string | null;
      landline_number?: string | null;
    }) =>
      request("/api/company-settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  },

  departments: {
    list: () => request<unknown[]>("/api/departments"),
    create: (body: { name: string; head_name?: string | null }) =>
      request("/api/departments", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { name?: string; head_name?: string | null }) =>
      request(`/api/departments/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request(`/api/departments/${id}`, { method: "DELETE" }),
  },

  roles: {
    list: () => request<unknown[]>("/api/roles"),
    create: (body: {
      name: string;
      description?: string;
      permissions: string[];
    }) => request("/api/roles", { method: "POST", body: JSON.stringify(body) }),
    update: (
      id: string,
      body: { name?: string; description?: string; permissions?: string[] },
    ) =>
      request(`/api/roles/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (id: string) => request(`/api/roles/${id}`, { method: "DELETE" }),
  },

  approvalTypes: {
    list: (departmentId?: string) =>
      request<unknown[]>(
        `/api/approval-types${departmentId ? `?department_id=${encodeURIComponent(departmentId)}` : ""}`,
      ),
    create: (body: {
      name: string;
      description?: string;
      fields: unknown[];
      page_layout?: string;
      pre_salutation?: string | null;
      post_salutation?: string | null;
      allow_attachments?: boolean;
      attachment_fields?: unknown[];
      department_id?: string | null;
    }) =>
      request("/api/approval-types", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      body: {
        name?: string;
        description?: string;
        fields?: unknown[];
        page_layout?: string;
        pre_salutation?: string | null;
        post_salutation?: string | null;
        allow_attachments?: boolean;
        attachment_fields?: unknown[];
        department_id?: string | null;
      },
    ) =>
      request(`/api/approval-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request(`/api/approval-types/${id}`, { method: "DELETE" }),
  },

  approvalChains: {
    list: () => request<unknown[]>("/api/approval-chains"),
    create: (body: {
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
    }) =>
      request("/api/approval-chains", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      body: {
        name?: string;
        approval_type_id?: string;
        work_assignee_id?: string | null;
        steps?: Array<{
          step_order: number;
          name: string;
          role: string;
          scope_type: "initiator_department" | "fixed_department" | "static" | "expression";
          scope_value?: string | null;
          action_label: string;
        }>;
      },
    ) =>
      request(`/api/approval-chains/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request(`/api/approval-chains/${id}`, { method: "DELETE" }),
  },

  profiles: {
    get: (id: string) =>
      request<{
        id: string;
        full_name: string;
        email: string;
        signature_url?: string | null;
        department_id: string | null;
        role_id: string | null;
        department_name: string | null;
        role_name: string | null;
      }>(`/api/profiles/${id}`),
    list: () => request<Profile[]>("/api/profiles"),
    lookupNames: (ids: string[]) => {
      if (ids.length === 0)
        return Promise.resolve({} as Record<string, string>);
      const q = encodeURIComponent(ids.join(","));
      return request<Record<string, string>>(`/api/profiles/lookup?ids=${q}`);
    },
  },

  admin: {
    createUser: (body: {
      email: string;
      password: string;
      full_name: string;
      signature_url?: string | null;
      department_id?: string | null;
      department_ids?: string[];
      role_id?: string | null;
      role_ids?: string[];
      is_admin?: boolean;
    }) =>
      request<{ id: string; email: string; profile: Profile }>(
        "/api/admin/users",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),
    updateUser: (
      userId: string,
      body: {
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
      },
    ) =>
      request<{ profile: Profile }>(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    deleteUser: (userId: string) =>
      request<{ success: boolean }>(`/api/admin/users/${userId}`, {
        method: "DELETE",
      }),
    resetUserPassword: (userId: string, new_password: string) =>
      request<{ success: boolean }>(`/api/admin/users/${userId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ new_password }),
      }),
    uploadUserSignature: (userId: string, file: File) => {
      const formData = new FormData();
      formData.append("signature", file);
      return uploadForm<{ profile: Profile }>(
        `/api/admin/users/${userId}/signature`,
        formData,
      );
    },
  },

  approvalRequests: {
    list: () => request<unknown[]>("/api/approval-requests"),
    listAssignees: (departmentId?: string | null) => {
      const departmentQuery =
        departmentId === null
          ? "?department_id=all"
          : departmentId
            ? `?department_id=${encodeURIComponent(departmentId)}`
            : "";
      return request<unknown[]>(`/api/approval-requests/assignees${departmentQuery}`);
    },
    get: (id: string) =>
      request<{
        request: Record<string, unknown> & {
          initiator?: { full_name: string; signature_url?: string | null };
          approval_types?: unknown;
          departments?: unknown;
        };
        actions: Record<string, unknown>[];
        actorNames: Record<string, string>;
        actorProfiles?: Record<
          string,
          { full_name: string; signature_url: string | null; department_name: string | null }
        >;
      }>(`/api/approval-requests/${id}`),
    create: (body: {
      approval_type_id: string;
      approval_chain_id?: string | null;
      department_id?: string | null;
      form_data: Record<string, unknown>;
      current_step: number;
      total_steps: number;
      status: string;
    }) =>
      request("/api/approval-requests", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    approve: (id: string, body: { comment?: string }) =>
      request("/api/approval-requests/" + id + "/approve", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    reject: (id: string, body: { comment: string }) =>
      request("/api/approval-requests/" + id + "/reject", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { form_data: Record<string, unknown>; comment?: string }) =>
      request("/api/approval-requests/" + id, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    assignWork: (id: string, body: { assignee_id: string }) =>
      request("/api/approval-requests/" + id + "/assign-work", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateWorkStatus: (
      id: string,
      body: { status: "pending" | "assigned" | "in_progress" | "done"; comment?: string },
    ) =>
      request("/api/approval-requests/" + id + "/work-status", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      request<{ success: boolean }>("/api/approval-requests/" + id, {
        method: "DELETE",
      }),
    resolveNumber: (requestNumber: string) =>
      request<{ id: string }>(
        `/api/approval-requests/by-number/${encodeURIComponent(requestNumber)}`,
      ),
  },

  notifications: {
    list: (limit = 30) =>
      request<{
        notifications: AppNotification[];
        unreadCount: number;
      }>(`/api/notifications?limit=${encodeURIComponent(String(limit))}`),
    markRead: (id: string) =>
      request<{ success: boolean }>(`/api/notifications/${id}/read`, {
        method: "POST",
      }),
    markAllRead: () =>
      request<{ success: boolean }>("/api/notifications/read-all", {
        method: "POST",
      }),
  },

  auditLogs: {
    list: () =>
      request<
        {
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
        }[]
      >("/api/audit-logs"),
  },
};

export { request };
