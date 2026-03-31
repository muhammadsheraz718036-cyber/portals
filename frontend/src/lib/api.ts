/**
 * HTTP client for approval-central-api (Express + Postgres).
 * In dev, Vite proxies /api → backend. Set VITE_API_URL to full URL if needed.
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
    me: () => request<{ user: AuthUser; profile: Profile }>("/api/auth/me"),
    updatePassword: (body: {
      new_password: string;
      current_password?: string;
    }) =>
      request<{ success: boolean }>("/api/auth/me/password", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    updateProfile: (body: { full_name: string }) =>
      request<{ profile: Profile }>("/api/auth/me/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  },

  companySettings: {
    get: () =>
      request<{
        id: string;
        company_name: string;
        logo_url: string | null;
        updated_at: string;
        updated_by: string | null;
      } | null>("/api/company-settings", { skipAuth: true }),
    update: (body: { company_name?: string; logo_url?: string | null }) =>
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
    list: () => request<unknown[]>("/api/approval-types"),
    create: (body: {
      name: string;
      description?: string;
      fields: unknown[];
      page_layout?: string;
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
      steps: unknown[];
    }) =>
      request("/api/approval-chains", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (
      id: string,
      body: { name?: string; approval_type_id?: string; steps?: unknown[] },
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
      department_id?: string | null;
      role_id?: string | null;
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
        full_name?: string;
        department_id?: string | null;
        role_id?: string | null;
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
  },

  approvalRequests: {
    list: () => request<unknown[]>("/api/approval-requests"),
    get: (id: string) =>
      request<{
        request: Record<string, unknown> & {
          initiator?: { full_name: string };
          approval_types?: unknown;
          departments?: unknown;
        };
        actions: Record<string, unknown>[];
        actorNames: Record<string, string>;
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
    reject: (id: string, body: { comment?: string }) =>
      request("/api/approval-requests/" + id + "/reject", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    requestChanges: (id: string, body: { comment?: string }) =>
      request("/api/approval-requests/" + id + "/request-changes", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { form_data: Record<string, unknown> }) =>
      request("/api/approval-requests/" + id, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    resolveNumber: (requestNumber: string) =>
      request<{ id: string }>(
        `/api/approval-requests/by-number/${encodeURIComponent(requestNumber)}`,
      ),
  },

  auditLogs: {
    list: () =>
      request<
        {
          id: string;
          user_name: string;
          action: string;
          target: string;
          details: string | null;
          created_at: string;
        }[]
      >("/api/audit-logs"),
  },
};

export { request };
