import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../httpError.js";
import { asyncHandler } from "../asyncHandler.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  isPasswordPolicyValid,
  PASSWORD_POLICY_MESSAGE,
} from "../auth/passwordPolicy.js";
import { signToken } from "../auth/jwt.js";
import {
  requireAuth,
  requireAdmin,
  type AuthedRequest,
} from "../middleware/auth.js";
import {
  upload,
  deleteUploadedFile,
  validateFileSize,
  getMimeType,
} from "../fileUpload.js";
import path from "path";
import fs from "fs/promises";
import { EmailNotificationService } from "../services/EmailNotificationService.js";

export const apiRouter = Router();
const uploadsRoot = path.resolve(process.cwd(), "uploads");
const emailNotificationService = new EmailNotificationService();

function sanitizeDownloadFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "_");
}

function isFileInsideUploads(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return (
    resolved === uploadsRoot || resolved.startsWith(`${uploadsRoot}${path.sep}`)
  );
}

async function signatureFileToDataUrl(file: Express.Multer.File): Promise<string> {
  const extension = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = new Set([".jpg", ".jpeg", ".png"]);
  const allowedMimeTypes = new Set(["image/jpeg", "image/png"]);

  if (!allowedExtensions.has(extension) || !allowedMimeTypes.has(file.mimetype)) {
    throw new HttpError(400, "Signature must be a PNG or JPG image");
  }
  if (!validateFileSize(file.size, 2)) {
    throw new HttpError(400, "Signature image must be 2MB or smaller");
  }

  const buffer = await fs.readFile(file.path);
  return `data:${file.mimetype};base64,${buffer.toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Approval routing helpers
// ---------------------------------------------------------------------------

type WorkflowScopeType =
  | "initiator_department"
  | "fixed_department"
  | "static"
  | "expression";

type WorkflowStepDefinition = {
  step_order: number;
  name: string;
  role: string;
  scope_type: WorkflowScopeType;
  scope_value: string | null;
  action_label: string;
};

type WorkflowRequestContext = {
  requestId: string;
  initiatorId: string;
  departmentId: string | null;
  formData?: Record<string, unknown>;
};

function toLegacyActorFields(step: WorkflowStepDefinition): {
  actor_type: "ROLE" | "USER_MANAGER" | "DEPARTMENT_MANAGER" | "SPECIFIC_USER";
  actor_value: string | null;
} {
  if (step.scope_type === "expression" && step.scope_value === "initiator_manager") {
    return { actor_type: "USER_MANAGER", actor_value: null };
  }

  if (step.scope_type === "expression" && step.scope_value?.startsWith("user:")) {
    return {
      actor_type: "SPECIFIC_USER",
      actor_value: step.scope_value.slice("user:".length),
    };
  }

  if (
    step.role.trim().toLowerCase() === "department manager" &&
    (step.scope_type === "initiator_department" || step.scope_type === "fixed_department")
  ) {
    return {
      actor_type: "DEPARTMENT_MANAGER",
      actor_value: step.scope_type === "fixed_department" ? step.scope_value : null,
    };
  }

  return {
    actor_type: "ROLE",
    actor_value: step.role,
  };
}

function isUuid(value: string | null | undefined): value is string {
  return !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeWorkflowStep(
  raw: Record<string, unknown>,
  index: number,
): WorkflowStepDefinition {
  const actorType =
    typeof raw.actor_type === "string" ? raw.actor_type.trim().toUpperCase() : null;
  const actorValue =
    typeof raw.actor_value === "string" && raw.actor_value.trim() !== ""
      ? raw.actor_value.trim()
      : null;
  const legacyRole =
    typeof raw.roleName === "string" && raw.roleName.trim() !== ""
      ? raw.roleName.trim()
      : typeof raw.role_name === "string" && raw.role_name.trim() !== ""
        ? raw.role_name.trim()
        : null;

  let role =
    typeof raw.role === "string" && raw.role.trim() !== ""
      ? raw.role.trim()
      : null;
  let scopeType =
    typeof raw.scope_type === "string" ? raw.scope_type.trim() : null;
  let scopeValue =
    typeof raw.scope_value === "string" && raw.scope_value.trim() !== ""
      ? raw.scope_value.trim()
      : null;

  if (!role) {
    if (actorType === "ROLE") {
      role = actorValue ?? legacyRole;
    } else if (actorType === "DEPARTMENT_MANAGER") {
      role = "Department Manager";
    } else if (actorType === "USER_MANAGER") {
      role = "Line Manager";
    } else if (actorType === "SPECIFIC_USER") {
      role = "Specific User";
    } else {
      role = legacyRole;
    }
  }

  if (!scopeType) {
    if (actorType === "DEPARTMENT_MANAGER") {
      scopeType = actorValue ? "fixed_department" : "initiator_department";
      scopeValue = actorValue;
    } else if (actorType === "USER_MANAGER") {
      scopeType = "expression";
      scopeValue = "initiator_manager";
    } else if (actorType === "SPECIFIC_USER") {
      scopeType = "expression";
      scopeValue = actorValue ? `user:${actorValue}` : null;
    } else {
      scopeType = "static";
    }
  }

  if (!role) {
    throw new HttpError(400, `Step ${index + 1}: role is required`);
  }

  if (
    scopeType !== "initiator_department" &&
    scopeType !== "fixed_department" &&
    scopeType !== "static" &&
    scopeType !== "expression"
  ) {
    throw new HttpError(400, `Step ${index + 1}: invalid scope_type`);
  }

  if (scopeType === "fixed_department" && !scopeValue) {
    throw new HttpError(400, `Step ${index + 1}: scope_value is required for fixed_department`);
  }

  if (scopeType === "expression" && !scopeValue) {
    throw new HttpError(400, `Step ${index + 1}: scope_value is required for expression`);
  }

  const stepOrder =
    typeof raw.step_order === "number"
      ? raw.step_order
      : typeof raw.order === "number"
        ? raw.order
        : index + 1;

  return {
    step_order: stepOrder,
    name:
      typeof raw.name === "string" && raw.name.trim() !== ""
        ? raw.name.trim()
        : `${role} Approval`,
    role,
    scope_type: scopeType,
    scope_value: scopeValue,
    action_label:
      typeof raw.action_label === "string" && raw.action_label.trim() !== ""
        ? raw.action_label.trim()
        : typeof raw.action === "string" && raw.action.trim() !== ""
          ? raw.action.trim()
          : "Review",
  };
}

function normalizeWorkflowSteps(rawSteps: unknown): WorkflowStepDefinition[] {
  const steps = Array.isArray(rawSteps) ? rawSteps : [];
  return steps
    .map((step, index) => normalizeWorkflowStep(step as Record<string, unknown>, index))
    .sort((a, b) => a.step_order - b.step_order)
    .map((step, index) => ({ ...step, step_order: index + 1 }));
}

async function resolveDepartmentScopeId(
  client: { query: typeof pool.query },
  scopeValue: string,
): Promise<string | null> {
  if (isUuid(scopeValue)) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM departments WHERE id = $1 LIMIT 1`,
      [scopeValue],
    );
    return rows[0]?.id ?? null;
  }

  const { rows } = await client.query<{ id: string }>(
    `SELECT id
       FROM departments
      WHERE lower(trim(name)) = lower(trim($1))
      LIMIT 1`,
    [scopeValue],
  );
  return rows[0]?.id ?? null;
}

async function resolveScopeDepartmentId(
  client: { query: typeof pool.query },
  step: WorkflowStepDefinition,
  request: WorkflowRequestContext,
): Promise<string | null> {
  if (step.scope_type === "initiator_department") {
    return request.departmentId;
  }

  if (step.scope_type === "fixed_department") {
    return step.scope_value ? resolveDepartmentScopeId(client, step.scope_value) : null;
  }

  if (step.scope_type === "expression") {
    if (
      step.scope_value === "initiator.department_id" ||
      step.scope_value === "request.department_id"
    ) {
      return request.departmentId;
    }

    if (step.scope_value?.startsWith("department:")) {
      return resolveDepartmentScopeId(client, step.scope_value.slice("department:".length));
    }
  }

  return null;
}

async function resolveApprover(
  client: { query: typeof pool.query },
  step: WorkflowStepDefinition,
  request: WorkflowRequestContext,
): Promise<string> {
  if (step.scope_type === "expression" && step.scope_value === "initiator_manager") {
    const { rows } = await client.query<{ id: string }>(
      `SELECT p.id
         FROM user_managers um
         JOIN profiles p ON p.id = um.manager_id
        WHERE um.user_id = $1
          AND um.is_active = true
          AND p.is_active = true
          AND p.id <> $1
        ORDER BY um.assigned_at ASC, p.created_at ASC
        LIMIT 1`,
      [request.initiatorId],
    );

    if (rows.length === 0) {
      throw new HttpError(400, `No initiator manager configured for step "${step.name}"`);
    }

    return rows[0].id;
  }

  if (step.scope_type === "expression" && step.scope_value?.startsWith("user:")) {
    const userId = step.scope_value.slice("user:".length);
    const { rows } = await client.query<{ id: string }>(
      `SELECT id
         FROM profiles
        WHERE id = $1
          AND is_active = true
          AND id <> $2
        LIMIT 1`,
      [userId, request.initiatorId],
    );

    if (rows.length === 0) {
      throw new HttpError(400, `No active specific approver configured for step "${step.name}"`);
    }

    return rows[0].id;
  }

  const scopedDepartmentId = await resolveScopeDepartmentId(client, step, request);

  if (
    (step.scope_type === "initiator_department" || step.scope_type === "fixed_department") &&
    !scopedDepartmentId
  ) {
    throw new HttpError(
      400,
      `Unable to resolve department scope for step "${step.name}"`,
    );
  }

  const params: unknown[] = [step.role, request.initiatorId];
  let departmentClause = "";

  if (scopedDepartmentId) {
    params.push(scopedDepartmentId);
    departmentClause = `AND (
      p.department_id = $3
      OR EXISTS (
        SELECT 1
        FROM user_departments ud
        WHERE ud.user_id = p.id
          AND ud.department_id = $3
      )
    )`;
  }

  const { rows } = await client.query<{ id: string }>(
    `SELECT p.id
       FROM profiles p
       LEFT JOIN roles primary_role ON primary_role.id = p.role_id
       LEFT JOIN user_roles ur ON ur.user_id = p.id
       LEFT JOIN roles secondary_role ON secondary_role.id = ur.role_id
      WHERE (
        lower(trim(primary_role.name)) = lower(trim($1))
        OR lower(trim(secondary_role.name)) = lower(trim($1))
      )
        AND p.is_active = true
        AND p.id <> $2
        ${departmentClause}
      GROUP BY p.id
      ORDER BY MIN(p.created_at) ASC
      LIMIT 1`,
    params,
  );

  if (rows.length === 0) {
    const scopeLabel =
      step.scope_type === "static"
        ? "global scope"
        : scopedDepartmentId ?? step.scope_value ?? step.scope_type;
    throw new HttpError(
      400,
      `No approver found for role "${step.role}" in ${scopeLabel}`,
    );
  }

  return rows[0].id;
}

/**
 * Resolve which specific user must act on a given chain step for a request.
 *
 * Priority:
 *   1. Active user in the request's department whose role matches the step's role.
 *   2. Active department manager of the request's department (if the step role
 *      could not be resolved within the department).
 *   3. Any active user (across departments) holding the step's role — last resort
 *      so an unscoped role like a global "General Manager" still routes somewhere.
 *
 * Returns null only if the role cannot be resolved at all (caller decides fallback).
 */
async function resolveStepApprover(
  client: { query: typeof pool.query },
  opts: { roleName: string; departmentId: string | null; initiatorId: string },
): Promise<string | null> {
  const { roleName, departmentId, initiatorId } = opts;
  if (!roleName) return null;

  // 1. Same department + same role, never the initiator themselves.
  // Support both primary role_id and the multi-role user_roles mapping.
  if (departmentId) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT p.id
         FROM profiles p
         LEFT JOIN roles primary_role ON primary_role.id = p.role_id
         LEFT JOIN user_roles ur ON ur.user_id = p.id
         LEFT JOIN roles secondary_role ON secondary_role.id = ur.role_id
        WHERE (
          p.department_id = $1
          OR EXISTS (
            SELECT 1
            FROM user_departments ud
            WHERE ud.user_id = p.id
              AND ud.department_id = $1
          )
        )
          AND (
            lower(trim(primary_role.name)) = lower(trim($2))
            OR lower(trim(secondary_role.name)) = lower(trim($2))
          )
          AND p.is_active = true
          AND p.id <> $3
        GROUP BY p.id
        ORDER BY MIN(p.created_at) ASC
        LIMIT 1`,
      [departmentId, roleName, initiatorId],
    );
    if (rows.length > 0) return rows[0].id;

    // 2. Active department manager (only if no role match in dept).
    const { rows: mgrRows } = await client.query<{ id: string }>(
      `SELECT p.id
         FROM department_managers dm
         JOIN profiles p ON p.id = dm.user_id
        WHERE dm.department_id = $1
          AND dm.is_active = true
          AND p.is_active = true
          AND p.id <> $2
        ORDER BY dm.assigned_at ASC
        LIMIT 1`,
      [departmentId, initiatorId],
    );
    if (mgrRows.length > 0) return mgrRows[0].id;
  }

  // 3. Any active user with the role anywhere.
  const { rows: anyRows } = await client.query<{ id: string }>(
    `SELECT p.id
       FROM profiles p
       LEFT JOIN roles primary_role ON primary_role.id = p.role_id
       LEFT JOIN user_roles ur ON ur.user_id = p.id
       LEFT JOIN roles secondary_role ON secondary_role.id = ur.role_id
      WHERE (
        lower(trim(primary_role.name)) = lower(trim($1))
        OR lower(trim(secondary_role.name)) = lower(trim($1))
      )
        AND p.is_active = true
        AND p.id <> $2
      GROUP BY p.id
      ORDER BY MIN(p.created_at) ASC
      LIMIT 1`,
    [roleName, initiatorId],
  );
  if (anyRows.length > 0) return anyRows[0].id;

  // 4. Final fallback: assign to an admin so the workflow can still move.
  const { rows: adminRows } = await client.query<{ id: string }>(
    `SELECT id FROM profiles
      WHERE is_admin = true AND is_active = true AND id <> $1
      ORDER BY created_at ASC LIMIT 1`,
    [initiatorId],
  );
  if (adminRows.length > 0) return adminRows[0].id;

  return null;
}

async function resolveRequestStepApprover(
  client: { query: typeof pool.query },
  opts: {
    step: {
      actor_type?: string | null;
      actor_value?: string | null;
      roleName?: string | null;
      role_name?: string | null;
    };
    departmentId: string | null;
    initiatorId: string;
  },
): Promise<string | null> {
  const actorType = opts.step.actor_type?.trim().toUpperCase();
  const actorValue = opts.step.actor_value?.trim() || null;
  const legacyRoleName =
    opts.step.roleName?.trim() || opts.step.role_name?.trim() || null;

  if (actorType === "SPECIFIC_USER" && actorValue && actorValue !== opts.initiatorId) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id
         FROM profiles
        WHERE id = $1
          AND is_active = true
          AND id <> $2
        LIMIT 1`,
      [actorValue, opts.initiatorId],
    );
    return rows[0]?.id ?? null;
  }

  if (actorType === "USER_MANAGER") {
    const { rows } = await client.query<{ id: string }>(
      `SELECT p.id
         FROM user_managers um
         JOIN profiles p ON p.id = um.manager_id
        WHERE um.user_id = $1
          AND um.is_active = true
          AND p.is_active = true
          AND p.id <> $1
        ORDER BY um.assigned_at ASC
        LIMIT 1`,
      [opts.initiatorId],
    );
    if (rows.length > 0) return rows[0].id;
  }

  if (actorType === "DEPARTMENT_MANAGER" && opts.departmentId) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT p.id
         FROM department_managers dm
         JOIN profiles p ON p.id = dm.user_id
        WHERE dm.department_id = $1
          AND dm.is_active = true
          AND p.is_active = true
          AND p.id <> $2
        ORDER BY dm.assigned_at ASC
        LIMIT 1`,
      [opts.departmentId, opts.initiatorId],
    );
    if (rows.length > 0) return rows[0].id;
  }

  const roleName =
    actorType === "ROLE" ? actorValue ?? legacyRoleName : legacyRoleName;

  if (roleName) {
    return resolveStepApprover(client, {
      roleName,
      departmentId: opts.departmentId,
      initiatorId: opts.initiatorId,
    });
  }

  return null;
}

/**
 * Build approval_actions rows for a brand-new request from its chain steps.
 * The first step is set to 'pending' (actionable now); subsequent steps are
 * 'waiting' until earlier steps complete.
 */
async function generateApprovalActionsForRequest(
  client: { query: typeof pool.query },
  opts: {
    requestId: string;
    chainSteps: WorkflowStepDefinition[];
    request: WorkflowRequestContext;
  },
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < opts.chainSteps.length; i++) {
    const step = opts.chainSteps[i];
    const approverId = await resolveApprover(client, step, opts.request);
    const status = i === 0 ? "pending" : "waiting";
    const legacy = toLegacyActorFields(step);

    await client.query(
      `INSERT INTO request_steps
         (request_id, step_order, name, actor_type, actor_value, action_label, status, assigned_to, approver_user_id, role, scope_type, scope_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)`,
      [
        opts.requestId,
        step.step_order,
        step.name,
        legacy.actor_type,
        legacy.actor_value,
        step.action_label,
        status.toUpperCase(),
        approverId,
        step.role,
        step.scope_type,
        step.scope_value,
      ],
    );

    await client.query(
      `INSERT INTO approval_actions
         (request_id, step_order, role_name, action_label, status, approver_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        opts.requestId,
        step.step_order,
        step.role,
        step.action_label,
        status,
        approverId,
      ],
    );
    inserted += 1;
  }
  return inserted;
}

/**
 * Find the lowest open approval_action on a request that the given user is
 * authorized to act on. Rules:
 *   * Admins may act on the lowest open step (any approver).
 *   * The pre-resolved assignee (approver_user_id) may act on their step.
 *   * A user whose role matches the step's role_name may act on it, with
 *     STRICT department isolation: the user must belong to the request's
 *     department, manage it, or the request must have no department.
 */
async function findActionableStep(
  client: { query: typeof pool.query },
  opts: { requestId: string; userId: string; isAdmin: boolean },
): Promise<Record<string, unknown> | null> {
  const { requestId, userId, isAdmin } = opts;
  if (isAdmin) {
    const { rows } = await client.query(
      `SELECT * FROM approval_actions
        WHERE request_id = $1 AND status IN ('pending', 'waiting')
        ORDER BY step_order ASC, created_at ASC LIMIT 1`,
      [requestId],
    );
    return rows[0] ?? null;
  }
  const { rows } = await client.query(
    `SELECT aa.*
       FROM approval_actions aa
      WHERE aa.request_id = $1
        AND aa.status = 'pending'
        AND aa.approver_user_id = $2
      ORDER BY aa.step_order ASC, aa.created_at ASC
      LIMIT 1`,
    [requestId, userId],
  );
  return rows[0] ?? null;
}

async function listEligibleWorkAssignees(
  client: { query: typeof pool.query },
  opts: { departmentId: string | null; excludeUserId?: string | null },
): Promise<
  Array<{
    id: string;
    full_name: string;
    email: string;
    department_name: string | null;
    department_names: string[];
    role_names: string[];
  }>
> {
  const params: unknown[] = [];
  let departmentClause = "";
  let exclusionClause = "";

  if (opts.excludeUserId) {
    params.push(opts.excludeUserId);
    exclusionClause = `AND p.id <> $${params.length}`;
  }

  if (opts.departmentId) {
    params.push(opts.departmentId);
    departmentClause = `AND (
      p.department_id = $${params.length}
      OR EXISTS (
        SELECT 1
          FROM user_departments ud
         WHERE ud.user_id = p.id
           AND ud.department_id = $${params.length}
      )
    )`;
  }

  const { rows } = await client.query<{
    id: string;
    full_name: string;
    email: string;
    department_name: string | null;
    department_names: string[] | null;
    role_names: string[] | null;
  }>(
    `SELECT DISTINCT
       p.id,
       p.full_name,
       p.email,
       d.name AS department_name,
       (
         SELECT COALESCE(array_agg(DISTINCT dept_name), ARRAY[]::text[])
           FROM (
             SELECT pd.name AS dept_name
             FROM departments pd
             WHERE pd.id = p.department_id
             UNION
             SELECT extra_department.name AS dept_name
               FROM user_departments ud
               JOIN departments extra_department ON extra_department.id = ud.department_id
              WHERE ud.user_id = p.id
           ) department_names
          WHERE dept_name IS NOT NULL
       ) AS department_names,
       (
         SELECT COALESCE(array_agg(DISTINCT role_name), ARRAY[]::text[])
           FROM (
             SELECT primary_role.name AS role_name
               FROM roles primary_role
              WHERE primary_role.id = p.role_id
             UNION
             SELECT extra_role.name AS role_name
               FROM user_roles ur
               JOIN roles extra_role ON extra_role.id = ur.role_id
              WHERE ur.user_id = p.id
           ) role_names
          WHERE role_name IS NOT NULL
       ) AS role_names
      FROM profiles p
      LEFT JOIN departments d ON d.id = p.department_id
     WHERE p.is_active = true
       AND p.email IS NOT NULL
       ${exclusionClause}
       ${departmentClause}
     ORDER BY p.full_name ASC, p.email ASC`,
    params,
  );

  return rows.map((row) => ({
    ...row,
    department_names: row.department_names ?? [],
    role_names: row.role_names ?? [],
  }));
}

async function ensureEligibleWorkAssignee(
  client: { query: typeof pool.query },
  opts: { departmentId: string | null; assigneeId: string; excludeUserId?: string | null },
): Promise<{ id: string; full_name: string; email: string }> {
  const eligible = await listEligibleWorkAssignees(client, {
    departmentId: opts.departmentId,
    excludeUserId: opts.excludeUserId,
  });
  const assignee = eligible.find((candidate) => candidate.id === opts.assigneeId);
  if (!assignee) {
    throw new HttpError(400, "Selected assignee is not eligible for this request");
  }
  return assignee;
}

async function resolveChainWorkAssigneeId(
  client: { query: typeof pool.query },
  opts: { approvalChainId: string },
): Promise<string | null> {
  const { rows: chainRows } = await client.query<{ default_work_assignee_id: string | null }>(
    `SELECT default_work_assignee_id
       FROM approval_chains
      WHERE id = $1
      LIMIT 1`,
    [opts.approvalChainId],
  );

  if (chainRows.length === 0) {
    throw new HttpError(404, "Approval chain not found");
  }

  return chainRows[0].default_work_assignee_id ?? null;
}

async function getFinalAuthorityUserId(
  client: { query: typeof pool.query },
  requestId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ acted_by: string | null }>(
    `SELECT acted_by
       FROM approval_actions
      WHERE request_id = $1
        AND status = 'approved'
      ORDER BY step_order DESC, acted_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [requestId],
  );
  return rows[0]?.acted_by ?? null;
}

// Helper function to log audit events
async function logAudit(
  userId: string,
  userName: string,
  action: string,
  target: string,
  details?: string | null,
) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_name, action, target, details) VALUES ($1, $2, $3, $4, $5)`,
      [userId, userName, action, target, details ?? null],
    );
  } catch (err) {
    // Log audit errors to console but don't fail the request
    console.error("Failed to log audit event:", err);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatChangeValue(value: unknown): string {
  if (value === undefined) return "not set";
  if (value === null) return "null";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : '""';
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const serialized = JSON.stringify(value);
  if (!serialized) return "empty";
  return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
}

function formatChangeLabel(path: string): string {
  return path
    .replace(/\.(\d+)\./g, "[$1].")
    .replace(/^items\./, "")
    .replace(/__group/g, "group")
    .trim();
}

function isGroupItemArray(value: unknown): value is Array<Record<string, unknown>> {
  return (
    Array.isArray(value) &&
    value.every((item) => isPlainObject(item))
  );
}

function collectGroupedItemChanges(
  beforeItems: Array<Record<string, unknown>>,
  afterItems: Array<Record<string, unknown>>,
  lines: string[],
) {
  const groups = Array.from(
    new Set([
      ...beforeItems.map((item) => String(item.__group || "General")),
      ...afterItems.map((item) => String(item.__group || "General")),
    ]),
  ).sort();

  for (const group of groups) {
    const beforeItem =
      beforeItems.find((item) => String(item.__group || "General") === group) ?? {};
    const afterItem =
      afterItems.find((item) => String(item.__group || "General") === group) ?? {};

    const keys = Array.from(
      new Set([
        ...Object.keys(beforeItem),
        ...Object.keys(afterItem),
      ]),
    )
      .filter((key) => key !== "id" && key !== "__group")
      .sort();

    for (const key of keys) {
      const beforeValue = beforeItem[key];
      const afterValue = afterItem[key];
      if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) {
        continue;
      }
      lines.push(
        `${group}.${key}: ${formatChangeValue(beforeValue)} -> ${formatChangeValue(afterValue)}`,
      );
    }
  }
}

function collectChangedFields(
  beforeValue: unknown,
  afterValue: unknown,
  fieldPath: string,
  lines: string[],
) {
  if (beforeValue === afterValue) {
    return;
  }

  if (fieldPath === "items" && isGroupItemArray(beforeValue) && isGroupItemArray(afterValue)) {
    collectGroupedItemChanges(beforeValue, afterValue, lines);
    return;
  }

  if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
    const keys = Array.from(
      new Set([...Object.keys(beforeValue), ...Object.keys(afterValue)]),
    ).sort();

    for (const key of keys) {
      const nextPath = fieldPath ? `${fieldPath}.${key}` : key;
      collectChangedFields(beforeValue[key], afterValue[key], nextPath, lines);
    }
    return;
  }

  const beforeSerialized = JSON.stringify(beforeValue);
  const afterSerialized = JSON.stringify(afterValue);
  if (beforeSerialized === afterSerialized) {
    return;
  }

  const label = fieldPath || "form_data";
  lines.push(
    `${formatChangeLabel(label)}: ${formatChangeValue(beforeValue)} -> ${formatChangeValue(afterValue)}`,
  );
}

function buildEditHistoryComment(args: {
  previousData: Record<string, unknown>;
  nextData: Record<string, unknown>;
  editorNote?: string;
}): string {
  const lines: string[] = [];
  collectChangedFields(args.previousData, args.nextData, "", lines);

  const summary: string[] = [];
  const totalChanges = lines.length;
  summary.push(
    totalChanges > 0
      ? `Request content updated. ${totalChanges} field${totalChanges === 1 ? "" : "s"} changed.`
      : "Request content updated. No field value differences were detected.",
  );

  if (totalChanges > 0) {
    summary.push("");
    summary.push("Changed fields:");
    for (const line of lines.slice(0, 20)) {
      summary.push(`- ${line}`);
    }
    if (totalChanges > 20) {
      summary.push(`- ...and ${totalChanges - 20} more changes`);
    }
  }

  const note = args.editorNote?.trim();
  if (note) {
    summary.push("");
    summary.push("Editor note:");
    summary.push(note);
  }

  return summary.join("\n");
}

async function syncApprovalChainSteps(
  client: { query: typeof pool.query },
  chainId: string,
  steps: WorkflowStepDefinition[],
) {
  await client.query(`DELETE FROM approval_steps WHERE chain_id = $1`, [chainId]);

  for (const step of steps) {
    const legacy = toLegacyActorFields(step);
    await client.query(
      `INSERT INTO approval_steps
         (chain_id, step_order, name, actor_type, actor_value, action_label, role, scope_type, scope_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        chainId,
        step.step_order,
        step.name,
        legacy.actor_type,
        legacy.actor_value,
        step.action_label,
        step.role,
        step.scope_type,
        step.scope_value,
      ],
    );
  }
}

async function syncRequestStepAction(
  client: { query: typeof pool.query },
  opts: {
    requestId: string;
    stepOrder: number;
    userId: string;
    status: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
    comment?: string;
  },
) {
  await client.query(
    `UPDATE request_steps
        SET status = $1,
            acted_by = $2,
            remarks = $3,
            completed_at = now()
      WHERE id = (
        SELECT id
          FROM request_steps
         WHERE request_id = $4
           AND step_order = $5
           AND status IN ('PENDING', 'WAITING')
         ORDER BY created_at DESC
         LIMIT 1
      )`,
    [opts.status, opts.userId, opts.comment ?? null, opts.requestId, opts.stepOrder],
  );
}

async function promoteNextRequestStep(
  client: { query: typeof pool.query },
  requestId: string,
) {
  await client.query(
    `UPDATE request_steps
        SET status = 'PENDING'
      WHERE id IN (
        SELECT id
          FROM request_steps
         WHERE request_id = $1
           AND status = 'WAITING'
           AND step_order = (
             SELECT MIN(step_order)
               FROM request_steps
              WHERE request_id = $1
                AND status = 'WAITING'
           )
      )`,
    [requestId],
  );
}

async function syncDepartmentManagerAssignment(
  client: { query: typeof pool.query },
  opts: {
    userId: string;
    assignedBy: string;
    departmentId: string | null;
    roleId: string | null;
    departmentIds?: string[];
    isActive: boolean;
    roleIds?: string[];
  },
) {
  const roleIds = [
    ...(opts.roleId ? [opts.roleId] : []),
    ...(opts.roleIds ?? []),
  ].filter((value, index, arr) => value && arr.indexOf(value) === index) as string[];

  if (opts.roleIds === undefined) {
    const { rows: existingRoles } = await client.query<{ role_id: string }>(
      `SELECT role_id FROM user_roles WHERE user_id = $1`,
      [opts.userId],
    );
    for (const row of existingRoles) {
      if (!roleIds.includes(row.role_id)) {
        roleIds.push(row.role_id);
      }
    }
  }

  let hasDepartmentManagerRole = false;
  if (roleIds.length > 0) {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id
         FROM roles
        WHERE id = ANY($1::uuid[])
          AND lower(trim(name)) = lower('Department Manager')`,
      [roleIds],
    );
    hasDepartmentManagerRole = rows.length > 0;
  }

  const desiredDepartmentIds = dedupeAssignedIds(opts.departmentId, opts.departmentIds);
  if (!hasDepartmentManagerRole || desiredDepartmentIds.length === 0 || !opts.isActive) {
    await client.query(
      `UPDATE department_managers
          SET is_active = false
        WHERE user_id = $1`,
      [opts.userId],
    );
    return;
  }

  await client.query(
    `UPDATE department_managers
        SET is_active = false
      WHERE user_id = $1
        AND department_id <> ALL($2::uuid[])`,
    [opts.userId, desiredDepartmentIds],
  );

  for (const departmentId of desiredDepartmentIds) {
    await client.query(
      `INSERT INTO department_managers (department_id, user_id, assigned_by, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (department_id, user_id)
       DO UPDATE SET is_active = true, assigned_by = EXCLUDED.assigned_by`,
      [departmentId, opts.userId, opts.assignedBy],
    );
  }
}

function dedupeAssignedIds(primaryId: string | null | undefined, ids?: string[]) {
  return [
    ...(primaryId ? [primaryId] : []),
    ...(ids ?? []),
  ].filter((value, index, arr) => !!value && arr.indexOf(value) === index) as string[];
}

async function syncUserDepartmentAssignments(
  client: { query: typeof pool.query },
  opts: {
    userId: string;
    assignedBy: string;
    departmentId: string | null;
    departmentIds?: string[];
  },
) {
  if (opts.departmentIds === undefined) {
    const desiredDepartmentIds = dedupeAssignedIds(opts.departmentId);
    await client.query(`DELETE FROM user_departments WHERE user_id = $1`, [opts.userId]);
    for (const departmentId of desiredDepartmentIds) {
      await client.query(
        `INSERT INTO user_departments (user_id, department_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, department_id) DO NOTHING`,
        [opts.userId, departmentId, opts.assignedBy],
      );
    }
    return desiredDepartmentIds;
  }

  const desiredDepartmentIds = dedupeAssignedIds(opts.departmentId, opts.departmentIds);
  await client.query(`DELETE FROM user_departments WHERE user_id = $1`, [opts.userId]);
  for (const departmentId of desiredDepartmentIds) {
    await client.query(
      `INSERT INTO user_departments (user_id, department_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, department_id) DO NOTHING`,
      [opts.userId, departmentId, opts.assignedBy],
    );
  }
  return desiredDepartmentIds;
}

// --- Public ---

apiRouter.get(
  "/setup/status",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM profiles`,
    );
    res.json({ hasUsers: rows[0].c > 0 });
  }),
);

const setupBody = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .refine(isPasswordPolicyValid, PASSWORD_POLICY_MESSAGE),
  full_name: z.string().min(1),
});

apiRouter.post(
  "/setup",
  asyncHandler(async (req, res) => {
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM profiles`,
    );
    if (cnt[0].c > 0) {
      throw new HttpError(400, "Setup already completed");
    }
    const body = setupBody.parse(req.body);
    const password_hash = await hashPassword(body.password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const u = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
        [body.email.toLowerCase(), password_hash],
      );
      const id = u.rows[0].id;
      await client.query(
        `INSERT INTO profiles (id, email, full_name, is_admin) VALUES ($1, $2, $3, true)`,
        [id, body.email.toLowerCase(), body.full_name.trim()],
      );
      await client.query("COMMIT");
      const token = signToken({ sub: id, email: body.email.toLowerCase() });
      const profile = await loadProfileById(id);
      res.status(201).json({
        token,
        user: { id, email: body.email.toLowerCase() },
        profile,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }),
);

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

apiRouter.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const body = loginBody.parse(req.body);
    const { rows } = await pool.query<{
      id: string;
      password_hash: string;
      email: string;
      is_locked: boolean;
      failed_login_attempts: number;
      is_admin: boolean;
    }>(
      `SELECT u.id, u.password_hash, u.email, p.is_locked, p.failed_login_attempts, p.is_admin
        FROM users u
        JOIN profiles p ON u.id = p.id
        WHERE u.email = $1`,
      [body.email.toLowerCase()],
    );
    if (rows.length === 0) {
      throw new HttpError(401, "Invalid email or password");
    }

    const user = rows[0];

    // Lock after failed attempts applies to non-admin accounts only; admins are never locked.
    if (user.is_locked && !user.is_admin) {
      throw new HttpError(
        423,
        "Account is locked due to too many failed login attempts. Please contact an administrator.",
      );
    }

    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) {
      if (!user.is_admin) {
        await pool.query(
          `UPDATE profiles SET
          failed_login_attempts = failed_login_attempts + 1,
          last_failed_login_at = now(),
          is_locked = CASE WHEN failed_login_attempts + 1 >= 3 THEN true ELSE false END,
          locked_at = CASE WHEN failed_login_attempts + 1 >= 3 THEN now() ELSE locked_at END
         WHERE id = $1`,
          [user.id],
        );
      }
      throw new HttpError(401, "Invalid email or password");
    }

    // Reset failed login attempts on successful login
    await pool.query(
      `UPDATE profiles SET
        failed_login_attempts = 0,
        last_failed_login_at = null,
        is_locked = false,
        locked_at = null
       WHERE id = $1`,
      [user.id],
    );

    const id = user.id;
    const token = signToken({ sub: id, email: user.email });
    const profile = await loadProfileById(id);
    if (!profile) {
      throw new HttpError(401, "Profile missing");
    }
    res.json({ token, user: { id, email: user.email }, profile });
  }),
);

async function ensureCompanySettingsColumns() {
  await pool.query(
    `ALTER TABLE company_settings
       ADD COLUMN IF NOT EXISTS phone_number TEXT,
       ADD COLUMN IF NOT EXISTS landline_number TEXT`,
  );
}

apiRouter.get(
  "/company-settings",
  asyncHandler(async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, company_name, logo_url, phone_number, landline_number, contact_department, updated_at, updated_by FROM company_settings LIMIT 1`,
      );
      if (rows.length === 0) {
        res.json(null);
        return;
      }
      res.json(rows[0]);
    } catch (err: any) {
      if (err.code === "42703") {
        await ensureCompanySettingsColumns();
        const { rows } = await pool.query(
          `SELECT id, company_name, logo_url, phone_number, landline_number, contact_department, updated_at, updated_by FROM company_settings LIMIT 1`,
        );
        if (rows.length === 0) {
          res.json(null);
          return;
        }
        res.json(rows[0]);
        return;
      }
      throw err;
    }
  }),
);

// --- Authenticated ---

apiRouter.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = req.auth!.userId;
    const { rows: u } = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [id],
    );
    const profile = await loadProfileById(id);
    res.json({ user: { id, email: u[0]?.email }, profile });
  }),
);

const passwordBody = z.object({
  new_password: z
    .string()
    .min(8)
    .refine(isPasswordPolicyValid, PASSWORD_POLICY_MESSAGE),
  current_password: z.string().optional(),
});

apiRouter.patch(
  "/auth/me/password",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = passwordBody.parse(req.body);
    const userId = req.auth!.userId;
    const { rows } = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId],
    );
    if (rows.length === 0) throw new HttpError(404, "User not found");
    const hash = rows[0].password_hash;
    if (body.current_password) {
      const ok = await verifyPassword(body.current_password, hash);
      if (!ok) throw new HttpError(400, "Current password is incorrect");
    }
    const newHash = await hashPassword(body.new_password);
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [newHash, userId],
    );
    res.json({ success: true });
  }),
);

const profileUpdateBody = z.object({
  full_name: z.string().min(1),
  signature_url: z.string().nullable().optional(),
});

apiRouter.patch(
  "/auth/me/profile",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = profileUpdateBody.parse(req.body);
    const userId = req.auth!.userId;

    const updates = ["full_name = $1"];
    const values: unknown[] = [body.full_name.trim()];
    let paramIdx = 2;
    if (body.signature_url !== undefined) {
      updates.push(`signature_url = $${paramIdx}`);
      values.push(body.signature_url?.trim() || null);
      paramIdx++;
    }
    updates.push("updated_at = now()");
    values.push(userId);

    await pool.query(
      `UPDATE profiles SET ${updates.join(", ")} WHERE id = $${paramIdx}`,
      values,
    );

    // Return updated profile
    const profile = await loadProfileById(userId);
    res.json({ profile });
  }),
);

apiRouter.post(
  "/auth/me/signature",
  requireAuth,
  upload.single("signature"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      throw new HttpError(400, "Signature image is required");
    }

    try {
      const signatureDataUrl = await signatureFileToDataUrl(file);
      await pool.query(
        `UPDATE profiles SET signature_url = $1, updated_at = now() WHERE id = $2`,
        [signatureDataUrl, req.auth!.userId],
      );

      const profile = await loadProfileById(req.auth!.userId);
      res.json({ profile });
    } finally {
      await deleteUploadedFile(file.path);
    }
  }),
);

apiRouter.patch(
  "/company-settings",
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        company_name: z.string().min(1).optional(),
        logo_url: z.string().nullable().optional(),
        phone_number: z.string().nullable().optional(),
        landline_number: z.string().nullable().optional(),
        contact_department: z.string().nullable().optional(),
      })
      .parse(req.body);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM company_settings LIMIT 1`,
    );

    if (rows.length === 0) {
      // Initialize company settings if they do not exist yet
      const { rows: inserted } = await pool.query(
        `INSERT INTO company_settings (company_name, logo_url, phone_number, landline_number, contact_department, updated_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          body.company_name ?? "ApprovalHub",
          body.logo_url ?? null,
          body.phone_number ?? null,
          body.landline_number ?? null,
          body.contact_department ?? "MIS Department",
          req.auth!.userId,
        ],
      );
      res.json(inserted[0]);
      return;
    }

    const id = rows[0].id;
    const parts: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (body.company_name !== undefined) {
      parts.push(`company_name = $${n++}`);
      vals.push(body.company_name);
    }
    if (body.logo_url !== undefined) {
      parts.push(`logo_url = $${n++}`);
      vals.push(body.logo_url);
    }
    if (body.phone_number !== undefined) {
      parts.push(`phone_number = $${n++}`);
      vals.push(body.phone_number);
    }
    if (body.landline_number !== undefined) {
      parts.push(`landline_number = $${n++}`);
      vals.push(body.landline_number);
    }
    if (body.contact_department !== undefined) {
      parts.push(`contact_department = $${n++}`);
      vals.push(body.contact_department);
    }
    if (parts.length === 0) {
      throw new HttpError(400, "No fields to update");
    }
    parts.push(`updated_at = now()`);
    parts.push(`updated_by = $${n++}`);
    vals.push(req.auth!.userId);
    vals.push(id);
    await pool.query(
      `UPDATE company_settings SET ${parts.join(", ")} WHERE id = $${n}`,
      vals,
    );
    const { rows: out } = await pool.query(
      `SELECT * FROM company_settings WHERE id = $1`,
      [id],
    );
    res.json(out[0]);
  }),
);

// Departments
apiRouter.get(
  "/departments",
  requireAuth,
  asyncHandler(async (_req: AuthedRequest, res) => {
    // Allow authenticated users to view departments for request selection
    const { rows } = await pool.query(
      `SELECT * FROM departments ORDER BY name`,
    );
    res.json(rows);
  }),
);

apiRouter.post(
  "/departments",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_departments permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_departments") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z
      .object({
        name: z.string().min(1),
      })
      .parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO departments (name) VALUES ($1) RETURNING *`,
      [body.name.trim()],
    );

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "CREATE",
      "Department",
      `Created department: ${body.name}`,
    );

    res.status(201).json(rows[0]);
  }),
);

apiRouter.patch(
  "/departments/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_departments permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_departments") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }
    const body = z
      .object({
        name: z.string().min(1).optional(),
      })
      .parse(req.body);
    const parts: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (body.name !== undefined) {
      parts.push(`name = $${n++}`);
      vals.push(body.name);
    }
    if (parts.length === 0) throw new HttpError(400, "No fields to update");
    parts.push(`updated_at = now()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE departments SET ${parts.join(", ")} WHERE id = $${n} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new HttpError(404, "Not found");

    // Log audit event
    const changes: string[] = [];
    if (body.name !== undefined) changes.push(`name: "${body.name}"`);

    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "Department",
      `Updated department ${rows[0].name}: ${changes.join(", ")}`,
    );

    res.json(rows[0]);
  }),
);

apiRouter.delete(
  "/departments/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_departments permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_departments") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    // Get department name for audit logging
    const { rows: dept } = await pool.query(
      `SELECT name FROM departments WHERE id = $1`,
      [req.params.id],
    );
    const deptName = dept[0]?.name || "Unknown";

    const r = await pool.query(`DELETE FROM departments WHERE id = $1`, [
      req.params.id,
    ]);
    if (r.rowCount === 0) throw new HttpError(404, "Not found");

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "DELETE",
      "Department",
      `Deleted department: ${deptName}`,
    );

    res.status(204).end();
  }),
);

// Department Managers
apiRouter.get(
  "/admin/departments/:departmentId/managers",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_departments") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const { rows } = await pool.query(
      `SELECT dm.id, dm.user_id, p.full_name, p.email, dm.is_active, dm.assigned_at
       FROM department_managers dm
       JOIN profiles p ON p.id = dm.user_id
       WHERE dm.department_id = $1
       ORDER BY dm.assigned_at DESC`,
      [req.params.departmentId],
    );

    res.json(rows);
  }),
);

apiRouter.post(
  "/admin/departments/:departmentId/managers",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_departments") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z.object({
      user_id: z.string().uuid(),
    }).parse(req.body);

    // Check if department exists
    const deptCheck = await pool.query(
      "SELECT id, name FROM departments WHERE id = $1",
      [req.params.departmentId],
    );
    if (deptCheck.rowCount === 0) {
      throw new HttpError(404, "Department not found");
    }
    const deptName = deptCheck.rows[0].name;

    // Check if user exists
    const userCheck = await pool.query(
      "SELECT id, full_name FROM profiles WHERE id = $1",
      [body.user_id],
    );
    if (userCheck.rowCount === 0) {
      throw new HttpError(404, "User not found");
    }
    const userName = userCheck.rows[0].full_name;

    // Assign as department manager
    await pool.query(
      `INSERT INTO department_managers (department_id, user_id, assigned_by, is_active) 
       VALUES ($1, $2, $3, true) 
       ON CONFLICT (department_id, user_id) DO UPDATE SET is_active = true`,
      [req.params.departmentId, body.user_id, req.auth!.userId],
    );

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "Department",
      `Assigned ${userName} as manager of ${deptName}`,
    );

    res.json({ success: true });
  }),
);

apiRouter.delete(
  "/admin/departments/:departmentId/managers/:userId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_departments") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    // Get info for audit
    const deptRes = await pool.query(
      "SELECT name FROM departments WHERE id = $1",
      [req.params.departmentId],
    );
    const deptName = deptRes.rows[0]?.name || "Unknown";

    const userRes = await pool.query(
      "SELECT full_name FROM profiles WHERE id = $1",
      [req.params.userId],
    );
    const userName = userRes.rows[0]?.full_name || "Unknown";

    const result = await pool.query(
      "DELETE FROM department_managers WHERE department_id = $1 AND user_id = $2",
      [req.params.departmentId, req.params.userId],
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, "Department manager not found");
    }

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "Department",
      `Removed ${userName} as manager of ${deptName}`,
    );

    res.json({ success: true });
  }),
);

// Roles
apiRouter.get(
  "/roles",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_roles/manage_users permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_roles") ||
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const { rows } = await pool.query(`SELECT * FROM roles ORDER BY name`);
    res.json(rows);
  }),
);

apiRouter.post(
  "/roles",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_roles permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_roles") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        permissions: z.array(z.string()),
      })
      .parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO roles (name, description, permissions) VALUES ($1, $2, $3) RETURNING *`,
      [body.name.trim(), body.description ?? "", body.permissions],
    );

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "CREATE",
      "Role",
      `Created role: ${body.name}`,
    );

    res.status(201).json(rows[0]);
  }),
);

apiRouter.patch(
  "/roles/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_roles permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_roles") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    // Prevent non-admin users from modifying their own role's permissions
    if (!isAdmin && req.params.id === req.profile?.role_id) {
      const currentRolePermissions = req.profile?.permissions || [];
      const hasAdminConsoleAccess =
        currentRolePermissions.includes("manage_users") ||
        currentRolePermissions.includes("manage_roles") ||
        currentRolePermissions.includes("manage_departments") ||
        currentRolePermissions.includes("manage_approval_types") ||
        currentRolePermissions.includes("manage_chains") ||
        currentRolePermissions.includes("all");

      if (hasAdminConsoleAccess) {
        throw new HttpError(
          403,
          "You cannot modify permissions for your own role",
        );
      }
    }

    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        permissions: z.array(z.string()).optional(),
      })
      .parse(req.body);
    const parts: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (body.name !== undefined) {
      parts.push(`name = $${n++}`);
      vals.push(body.name);
    }
    if (body.description !== undefined) {
      parts.push(`description = $${n++}`);
      vals.push(body.description);
    }
    if (body.permissions !== undefined) {
      parts.push(`permissions = $${n++}`);
      vals.push(body.permissions);
    }
    if (parts.length === 0) throw new HttpError(400, "No fields to update");
    parts.push(`updated_at = now()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE roles SET ${parts.join(", ")} WHERE id = $${n} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new HttpError(404, "Not found");

    // Log audit event
    const changes: string[] = [];
    if (body.name !== undefined) changes.push(`name: "${body.name}"`);
    if (body.description !== undefined)
      changes.push(`description: "${body.description}"`);
    if (body.permissions !== undefined) changes.push(`permissions updated`);

    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "Role",
      `Updated role ${rows[0].name}: ${changes.join(", ")}`,
    );

    res.json(rows[0]);
  }),
);

apiRouter.delete(
  "/roles/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_roles permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_roles") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    // Get role name for audit logging
    const { rows: role } = await pool.query(
      `SELECT name FROM roles WHERE id = $1`,
      [req.params.id],
    );
    const roleName = role[0]?.name || "Unknown";

    const r = await pool.query(`DELETE FROM roles WHERE id = $1`, [
      req.params.id,
    ]);
    if (r.rowCount === 0) throw new HttpError(404, "Not found");

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "DELETE",
      "Role",
      `Deleted role: ${roleName}`,
    );

    res.status(204).end();
  }),
);

// Approval types
apiRouter.get(
  "/approval-types",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user can manage approval types or initiate requests.
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_approval_types") ||
      req.profile?.permissions?.includes("initiate_request") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const departmentId =
      (req.query.department_id as string | undefined) ??
      req.profile?.department_id;

    let query = "SELECT * FROM approval_types";
    const params: unknown[] = [];

    if (departmentId) {
      query += " WHERE department_id = $1 OR department_id IS NULL";
      params.push(departmentId);
    } else if (!isAdmin) {
      query += " WHERE department_id IS NULL";
    }

    query += " ORDER BY name";

    const { rows } = await pool.query(query, params);
    res.json(rows);
  }),
);

apiRouter.post(
  "/approval-types",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_approval_types permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_approval_types") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        fields: z.array(z.any()),
        page_layout: z.enum(["portrait", "landscape"]).optional(),
        pre_salutation: z.string().nullable().optional(),
        post_salutation: z.string().nullable().optional(),
        allow_attachments: z.boolean().default(false),
        department_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO approval_types (name, description, fields, page_layout, pre_salutation, post_salutation, allow_attachments, department_id, created_by) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        body.name.trim(),
        body.description ?? "",
        JSON.stringify(body.fields),
        body.page_layout ?? "portrait",
        body.pre_salutation ?? null,
        body.post_salutation ?? null,
        body.allow_attachments,
        body.department_id ?? null,
        req.auth!.userId,
      ],
    );

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "CREATE",
      "Approval Type",
      `Created approval type: ${body.name}`,
    );

    res.status(201).json(rows[0]);
  }),
);

apiRouter.patch(
  "/approval-types/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_approval_types permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_approval_types") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        fields: z.array(z.any()).optional(),
        page_layout: z.enum(["portrait", "landscape"]).optional(),
        pre_salutation: z.string().nullable().optional(),
        post_salutation: z.string().nullable().optional(),
        allow_attachments: z.boolean().optional(),
        department_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const parts: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (body.name !== undefined) {
      parts.push(`name = $${n++}`);
      vals.push(body.name);
    }
    if (body.description !== undefined) {
      parts.push(`description = $${n++}`);
      vals.push(body.description);
    }
    if (body.fields !== undefined) {
      parts.push(`fields = $${n++}::jsonb`);
      vals.push(JSON.stringify(body.fields));
    }
    if (body.page_layout !== undefined) {
      parts.push(`page_layout = $${n++}`);
      vals.push(body.page_layout);
    }
    if (body.pre_salutation !== undefined) {
      parts.push(`pre_salutation = $${n++}`);
      vals.push(body.pre_salutation);
    }
    if (body.post_salutation !== undefined) {
      parts.push(`post_salutation = $${n++}`);
      vals.push(body.post_salutation);
    }
    if (body.allow_attachments !== undefined) {
      parts.push(`allow_attachments = $${n++}`);
      vals.push(body.allow_attachments);
    }
    if (body.department_id !== undefined) {
      parts.push(`department_id = $${n++}`);
      vals.push(body.department_id);
    }
    if (parts.length === 0) throw new HttpError(400, "No fields to update");
    parts.push(`updated_at = now()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE approval_types SET ${parts.join(", ")} WHERE id = $${n} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new HttpError(404, "Not found");

    // Log audit event
    const changes: string[] = [];
    if (body.name !== undefined) changes.push(`name: "${body.name}"`);
    if (body.description !== undefined)
      changes.push(`description: "${body.description}"`);
    if (body.fields !== undefined) changes.push(`fields updated`);
    if (body.page_layout !== undefined)
      changes.push(`page_layout: "${body.page_layout}"`);
    if (body.pre_salutation !== undefined)
      changes.push(`pre_salutation updated`);
    if (body.post_salutation !== undefined)
      changes.push(`post_salutation updated`);
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "Approval Type",
      `Updated approval type ${rows[0].name}: ${changes.join(", ")}`,
    );

    res.json(rows[0]);
  }),
);

apiRouter.delete(
  "/approval-types/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_approval_types permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_approval_types") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }
    // Get approval type name for audit logging
    const { rows: approvalType } = await pool.query(
      `SELECT name FROM approval_types WHERE id = $1`,
      [req.params.id],
    );
    const approvalTypeName = approvalType[0]?.name || "Unknown";

    const r = await pool.query(`DELETE FROM approval_types WHERE id = $1`, [
      req.params.id,
    ]);
    if (r.rowCount === 0) throw new HttpError(404, "Not found");

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "DELETE",
      "Approval Type",
      `Deleted approval type: ${approvalTypeName}`,
    );

    res.status(204).end();
  }),
);

// File attachments for approval types
apiRouter.get(
  "/approval-types/:id/attachments",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user can manage approval types or initiate requests.
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_approval_types") ||
      req.profile?.permissions?.includes("initiate_request") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const { rows } = await pool.query(
      `SELECT * FROM approval_type_attachments WHERE approval_type_id = $1 ORDER BY field_name`,
      [req.params.id],
    );
    res.json(rows);
  }),
);

apiRouter.post(
  "/approval-types/:id/attachments",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_approval_types permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_approval_types") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z
      .object({
        field_name: z.string().min(1),
        label: z.string().min(1),
        required: z.boolean().default(false),
        max_file_size_mb: z.number().min(1).max(100).default(10),
        allowed_extensions: z
          .array(z.string())
          .default(["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png"]),
        max_files: z.number().min(1).max(10).default(1),
      })
      .parse(req.body);

    const { rows } = await pool.query(
      `INSERT INTO approval_type_attachments (approval_type_id, field_name, label, required, max_file_size_mb, allowed_extensions, max_files) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.params.id,
        body.field_name,
        body.label,
        body.required,
        body.max_file_size_mb,
        body.allowed_extensions,
        body.max_files,
      ],
    );

    // Update approval type to indicate it allows attachments
    await pool.query(
      `UPDATE approval_types SET allow_attachments = true, updated_at = now() WHERE id = $1`,
      [req.params.id],
    );

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "CREATE",
      "Approval Type Attachment",
      `Added attachment field: ${body.label} to approval type`,
    );

    res.status(201).json(rows[0]);
  }),
);

apiRouter.patch(
  "/approval-types/:typeId/attachments/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_approval_types permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_approval_types") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z
      .object({
        label: z.string().min(1).optional(),
        required: z.boolean().optional(),
        max_file_size_mb: z.number().min(1).max(100).optional(),
        allowed_extensions: z.array(z.string()).optional(),
        max_files: z.number().min(1).max(10).optional(),
      })
      .parse(req.body);

    const parts: string[] = [];
    const vals: unknown[] = [];
    let n = 1;

    if (body.label !== undefined) {
      parts.push(`label = $${n++}`);
      vals.push(body.label);
    }
    if (body.required !== undefined) {
      parts.push(`required = $${n++}`);
      vals.push(body.required);
    }
    if (body.max_file_size_mb !== undefined) {
      parts.push(`max_file_size_mb = $${n++}`);
      vals.push(body.max_file_size_mb);
    }
    if (body.allowed_extensions !== undefined) {
      parts.push(`allowed_extensions = $${n++}`);
      vals.push(body.allowed_extensions);
    }
    if (body.max_files !== undefined) {
      parts.push(`max_files = $${n++}`);
      vals.push(body.max_files);
    }

    if (parts.length === 0) throw new HttpError(400, "No fields to update");
    parts.push(`updated_at = now()`);
    vals.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE approval_type_attachments SET ${parts.join(", ")} WHERE id = $${n} AND approval_type_id = $${n + 1} RETURNING *`,
      [...vals, req.params.typeId],
    );

    if (rows.length === 0) throw new HttpError(404, "Not found");

    res.json(rows[0]);
  }),
);

apiRouter.delete(
  "/approval-types/:typeId/attachments/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_approval_types permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_approval_types") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    // Get attachment info for audit logging
    const { rows: attachment } = await pool.query(
      `SELECT label FROM approval_type_attachments WHERE id = $1 AND approval_type_id = $2`,
      [req.params.id, req.params.typeId],
    );
    const attachmentLabel = attachment[0]?.label || "Unknown";

    const r = await pool.query(
      `DELETE FROM approval_type_attachments WHERE id = $1 AND approval_type_id = $2`,
      [req.params.id, req.params.typeId],
    );

    if (r.rowCount === 0) throw new HttpError(404, "Not found");

    // Check if this was the last attachment field for this approval type
    const { rows: remaining } = await pool.query(
      `SELECT COUNT(*)::int as count FROM approval_type_attachments WHERE approval_type_id = $1`,
      [req.params.typeId],
    );

    if (remaining[0].count === 0) {
      await pool.query(
        `UPDATE approval_types SET allow_attachments = false, updated_at = now() WHERE id = $1`,
        [req.params.typeId],
      );
    }

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "DELETE",
      "Approval Type Attachment",
      `Deleted attachment field: ${attachmentLabel}`,
    );

    res.status(204).end();
  }),
);

// File upload endpoint for requests
apiRouter.post(
  "/requests/:id/attachments",
  requireAuth,
  upload.array("files", 5), // Allow up to 5 files
  asyncHandler(async (req: AuthedRequest, res) => {
    const requestId = req.params.id;
    const fieldName = req.body.field_name;
    const files = req.files as Express.Multer.File[];

    if (!fieldName) {
      throw new HttpError(400, "field_name is required");
    }

    if (!files || files.length === 0) {
      throw new HttpError(400, "No files uploaded");
    }

    // Get the request and verify user has access
    const { rows: requests } = await pool.query(
      `SELECT ar.*, at.allow_attachments FROM approval_requests ar 
       JOIN approval_types at ON ar.approval_type_id = at.id 
       WHERE ar.id = $1`,
      [requestId],
    );

    if (requests.length === 0) {
      throw new HttpError(404, "Request not found");
    }

    const request = requests[0];
    const userId = req.auth!.userId;

    // Check if user can upload files (initiator or admin)
    const isAdmin = req.profile?.is_admin;
    if (request.initiator_id !== userId && !isAdmin) {
      throw new HttpError(
        403,
        "You can only upload files to your own requests",
      );
    }

    if (!request.allow_attachments) {
      throw new HttpError(
        400,
        "This approval type does not allow file attachments",
      );
    }

    // Get attachment configuration for this field
    const { rows: attachmentConfig } = await pool.query(
      `SELECT * FROM approval_type_attachments WHERE approval_type_id = $1 AND field_name = $2`,
      [request.approval_type_id, fieldName],
    );

    if (attachmentConfig.length === 0) {
      throw new HttpError(400, "Invalid attachment field");
    }

    const config = attachmentConfig[0];

    // Validate file count
    if (files.length > config.max_files) {
      throw new HttpError(400, `Maximum ${config.max_files} files allowed`);
    }

    // Validate each file
    try {
      for (const file of files) {
        // Validate file size
        if (!validateFileSize(file.size, config.max_file_size_mb)) {
          throw new HttpError(
            400,
            `File ${file.originalname} exceeds maximum size of ${config.max_file_size_mb}MB`,
          );
        }

        // Validate file extension
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        if (!config.allowed_extensions.includes(ext)) {
          throw new HttpError(
            400,
            `File type .${ext} not allowed for field ${fieldName}`,
          );
        }
      }

      // Insert file records into database
      const insertedFiles = [];
      for (const file of files) {
        const { rows: inserted } = await pool.query(
          `INSERT INTO request_attachments (request_id, approval_type_attachment_id, field_name, original_filename, stored_filename, file_path, file_size_bytes, mime_type, uploaded_by) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            requestId,
            config.id,
            fieldName,
            file.originalname,
            file.filename,
            file.path,
            file.size,
            file.mimetype || getMimeType(file.filename),
            userId,
          ],
        );
        insertedFiles.push(inserted[0]);
      }

      // Update request to indicate it has attachments
      await pool.query(
        `UPDATE approval_requests SET has_attachments = true, updated_at = now() WHERE id = $1`,
        [requestId],
      );

      // Log audit event
      await logAudit(
        userId,
        req.profile!.full_name,
        "UPLOAD",
        "Request Attachments",
        `Uploaded ${files.length} file(s) to request ${requestId}`,
      );

      res.status(201).json(insertedFiles);
    } catch (e) {
      // Best-effort cleanup for files already written to disk.
      await Promise.all(files.map((f) => deleteUploadedFile(f.path)));
      throw e;
    }
  }),
);

// Get attachments for a request
apiRouter.get(
  "/requests/:id/attachments",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const requestId = req.params.id;
    const userId = req.auth!.userId;

    // Get the request and verify user has access
    const { rows: requests } = await pool.query(
      `SELECT * FROM approval_requests WHERE id = $1`,
      [requestId],
    );

    if (requests.length === 0) {
      throw new HttpError(404, "Request not found");
    }

    const request = requests[0];
    const isAdmin = req.profile?.is_admin;

    // Check if user can view attachments (initiator or admin)
    if (request.initiator_id !== userId && !isAdmin) {
      throw new HttpError(
        403,
        "You can only view attachments for your own requests",
      );
    }

    const { rows } = await pool.query(
      `SELECT ra.*, ata.label as field_label FROM request_attachments ra 
       JOIN approval_type_attachments ata ON ra.approval_type_attachment_id = ata.id 
       WHERE ra.request_id = $1 ORDER BY ra.created_at`,
      [requestId],
    );

    res.json(rows);
  }),
);

// Download a file attachment
apiRouter.get(
  "/attachments/:id/download",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const attachmentId = req.params.id;
    const userId = req.auth!.userId;

    // Get attachment and request info
    const { rows: attachments } = await pool.query(
      `SELECT ra.*, ar.initiator_id FROM request_attachments ra 
       JOIN approval_requests ar ON ra.request_id = ar.id 
       WHERE ra.id = $1`,
      [attachmentId],
    );

    if (attachments.length === 0) {
      throw new HttpError(404, "Attachment not found");
    }

    const attachment = attachments[0];
    const isAdmin = req.profile?.is_admin;

    // Check if user can download attachment (initiator or admin)
    if (attachment.initiator_id !== userId && !isAdmin) {
      throw new HttpError(
        403,
        "You can only download attachments for your own requests",
      );
    }

    if (!isFileInsideUploads(attachment.file_path)) {
      throw new HttpError(400, "Invalid attachment file path");
    }

    // Set headers for file download
    const safeFilename = sanitizeDownloadFilename(attachment.original_filename);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFilename}"`,
    );
    res.setHeader("Content-Type", attachment.mime_type);

    // Send file
    res.sendFile(attachment.file_path, (err) => {
      if (err) {
        console.error("Error sending file:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to download file" });
        }
      }
    });
  }),
);

// Delete a file attachment
apiRouter.delete(
  "/attachments/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const attachmentId = req.params.id;
    const userId = req.auth!.userId;

    // Get attachment and request info
    const { rows: attachments } = await pool.query(
      `SELECT ra.*, ar.initiator_id, ar.status FROM request_attachments ra 
       JOIN approval_requests ar ON ra.request_id = ar.id 
       WHERE ra.id = $1`,
      [attachmentId],
    );

    if (attachments.length === 0) {
      throw new HttpError(404, "Attachment not found");
    }

    const attachment = attachments[0];
    const isAdmin = req.profile?.is_admin;

    // Check if user can delete attachment (initiator or admin, and only if request is still pending)
    if (attachment.initiator_id !== userId && !isAdmin) {
      throw new HttpError(
        403,
        "You can only delete attachments for your own requests",
      );
    }

    if (
      attachment.status !== "pending" &&
      attachment.status !== "in_progress"
    ) {
      throw new HttpError(
        400,
        "Cannot delete attachments for requests that are already approved or rejected",
      );
    }

    // Delete file from storage
    await deleteUploadedFile(attachment.file_path);

    // Delete from database
    await pool.query(`DELETE FROM request_attachments WHERE id = $1`, [
      attachmentId,
    ]);

    // Check if request has any remaining attachments
    const { rows: remaining } = await pool.query(
      `SELECT COUNT(*)::int as count FROM request_attachments WHERE request_id = $1`,
      [attachment.request_id],
    );

    if (remaining[0].count === 0) {
      await pool.query(
        `UPDATE approval_requests SET has_attachments = false, updated_at = now() WHERE id = $1`,
        [attachment.request_id],
      );
    }

    // Log audit event
    await logAudit(
      userId,
      req.profile!.full_name,
      "DELETE",
      "Request Attachment",
      `Deleted file: ${attachment.original_filename}`,
    );

    res.status(204).end();
  }),
);

// Approval chains
const workflowChainStepSchema = z.object({
  step_order: z.number().int().positive().optional(),
  order: z.number().int().positive().optional(),
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  roleName: z.string().min(1).optional(),
  role_name: z.string().min(1).optional(),
  scope_type: z
    .enum(["initiator_department", "fixed_department", "static", "expression"])
    .optional(),
  scope_value: z.string().optional().nullable(),
  action_label: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  actor_type: z.string().optional(),
  actor_value: z.string().optional(),
});

apiRouter.get(
  "/approval-chains",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user can manage chains or initiate requests.
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_chains") ||
      req.profile?.permissions?.includes("initiate_request") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const { rows } = await pool.query(
      `SELECT * FROM approval_chains ORDER BY name`,
    );
    res.json(
      rows.map((row) => ({
        ...row,
        work_assignee_id: row.default_work_assignee_id,
        steps: normalizeWorkflowSteps(row.steps),
      })),
    );
  }),
);

apiRouter.post(
  "/approval-chains",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_chains permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_chains") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z
      .object({
        name: z.string().min(1),
        approval_type_id: z.string().uuid(),
        steps: z.array(workflowChainStepSchema).min(1),
        work_assignee_id: z.string().uuid(),
      })
      .parse(req.body);
    const normalizedSteps = normalizeWorkflowSteps(body.steps);
    const client = await pool.connect();
    let created;
    try {
      await client.query("BEGIN");
      const assignee = await ensureEligibleWorkAssignee(client, {
        departmentId: null,
        assigneeId: body.work_assignee_id,
      });
      const { rows } = await client.query(
        `INSERT INTO approval_chains (name, approval_type_id, steps, default_work_assignee_id, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING *`,
        [
          body.name.trim(),
          body.approval_type_id,
          JSON.stringify(normalizedSteps),
          assignee.id,
          req.auth!.userId,
        ],
      );
      created = {
        ...rows[0],
        work_assignee_id: rows[0].default_work_assignee_id,
      };
      await syncApprovalChainSteps(client, created.id, normalizedSteps);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "CREATE",
      "Approval Chain",
      `Created approval chain: ${body.name}`,
    );

    res.status(201).json({
      ...created,
      steps: normalizedSteps,
    });
  }),
);

apiRouter.patch(
  "/approval-chains/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_chains permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_chains") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z
      .object({
        name: z.string().min(1).optional(),
        approval_type_id: z.string().uuid().optional(),
        steps: z.array(workflowChainStepSchema).min(1).optional(),
        work_assignee_id: z.string().uuid().optional(),
      })
      .parse(req.body);
    const parts: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (body.name !== undefined) {
      parts.push(`name = $${n++}`);
      vals.push(body.name);
    }
    if (body.approval_type_id !== undefined) {
      parts.push(`approval_type_id = $${n++}`);
      vals.push(body.approval_type_id);
    }
    if (body.steps !== undefined) {
      parts.push(`steps = $${n++}::jsonb`);
      vals.push(JSON.stringify(normalizeWorkflowSteps(body.steps)));
    }
    if (body.work_assignee_id !== undefined) {
      parts.push(`default_work_assignee_id = $${n++}`);
      vals.push(body.work_assignee_id);
    }
    if (parts.length === 0) throw new HttpError(400, "No fields to update");
    parts.push(`updated_at = now()`);
    vals.push(req.params.id);
    const client = await pool.connect();
    let updated;
    try {
      await client.query("BEGIN");
      if (body.work_assignee_id !== undefined) {
        await ensureEligibleWorkAssignee(client, {
          departmentId: null,
          assigneeId: body.work_assignee_id,
        });
      }
      const { rows } = await client.query(
        `UPDATE approval_chains SET ${parts.join(", ")} WHERE id = $${n} RETURNING *`,
        vals,
      );
      if (rows.length === 0) throw new HttpError(404, "Not found");
      updated = {
        ...rows[0],
        work_assignee_id: rows[0].default_work_assignee_id,
      };
      if (body.steps !== undefined) {
        await syncApprovalChainSteps(client, req.params.id, normalizeWorkflowSteps(body.steps));
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // Log audit event
    const changes: string[] = [];
    if (body.name !== undefined) changes.push(`name: "${body.name}"`);
    if (body.approval_type_id !== undefined)
      changes.push(`approval_type_id updated`);
    if (body.steps !== undefined) changes.push(`steps updated`);
    if (body.work_assignee_id !== undefined) changes.push(`work assignee updated`);

    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "Approval Chain",
      `Updated approval chain ${updated.name}: ${changes.join(", ")}`,
    );

    res.json({
      ...updated,
      steps:
        body.steps !== undefined
          ? normalizeWorkflowSteps(body.steps)
          : normalizeWorkflowSteps(updated.steps),
    });
  }),
);

apiRouter.delete(
  "/approval-chains/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_chains permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_chains") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    // Get approval chain name for audit logging
    const { rows: approvalChain } = await pool.query(
      `SELECT name FROM approval_chains WHERE id = $1`,
      [req.params.id],
    );
    const approvalChainName = approvalChain[0]?.name || "Unknown";

    const r = await pool.query(`DELETE FROM approval_chains WHERE id = $1`, [
      req.params.id,
    ]);
    if (r.rowCount === 0) throw new HttpError(404, "Not found");

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "DELETE",
      "Approval Chain",
      `Deleted approval chain: ${approvalChainName}`,
    );

    res.status(204).end();
  }),
);

// Resolve display names for request lists (authenticated)
apiRouter.get(
  "/profiles/lookup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const idsParam = req.query.ids;
    if (!idsParam || typeof idsParam !== "string") {
      res.json({});
      return;
    }
    const ids = idsParam.split(",").filter(Boolean);
    if (ids.length === 0) {
      res.json({});
      return;
    }
    const { rows } = await pool.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM profiles WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    res.json(Object.fromEntries(rows.map((r) => [r.id, r.full_name])));
  }),
);

// Get profile info with role (for any authenticated user)
apiRouter.get(
  "/profiles/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await loadProfileById(req.params.id);
    if (!profile) {
      throw new HttpError(404, "Profile not found");
    }
    res.json(profile);
  }),
);

// Profiles (admin list)
apiRouter.get(
  "/profiles",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_users permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const { rows } = await pool.query(
      `SELECT * FROM profiles WHERE NOT is_admin OR id = $1 ORDER BY created_at DESC`,
      [req.auth!.userId],
    );
    const profiles = (
      await Promise.all(rows.map((row) => loadProfileById(row.id)))
    ).filter(Boolean);
    res.json(profiles);
  }),
);

// Admin users
const createUserBody = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .refine(isPasswordPolicyValid, PASSWORD_POLICY_MESSAGE),
  full_name: z.string().min(1),
  department_id: z.string().uuid().nullable().optional(),
  department_ids: z.array(z.string().uuid()).optional(),
  role_id: z.string().uuid().nullable().optional(),
  role_ids: z.array(z.string().uuid()).optional(), // Support multiple roles on creation
  is_admin: z.boolean().optional(),
  signature_url: z.string().nullable().optional(),
});

apiRouter.post(
  "/admin/users",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_users permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = createUserBody.parse(req.body);
    const assignedDepartmentIds = dedupeAssignedIds(body.department_id ?? null, body.department_ids);
    const assignedRoleIds = dedupeAssignedIds(body.role_id ?? null, body.role_ids);

    if (!isAdmin && body.is_admin === true) {
      throw new HttpError(403, "Only admins can create admin users");
    }

    if (!isAdmin && assignedDepartmentIds.length === 0) {
      throw new HttpError(400, "Department is required when creating users");
    }

    if (!isAdmin && assignedRoleIds.length === 0) {
      throw new HttpError(400, "Role is required when creating users");
    }

    const password_hash = await hashPassword(body.password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const u = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
        [body.email.toLowerCase(), password_hash],
      );
      const id = u.rows[0].id;
      await client.query(
        `INSERT INTO profiles (id, email, full_name, department_id, role_id, is_admin, signature_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          body.email.toLowerCase(),
          body.full_name.trim(),
          assignedDepartmentIds[0] ?? null,
          assignedRoleIds[0] ?? null,
          body.is_admin ?? false,
          body.signature_url?.trim() || null,
        ],
      );

      await syncUserDepartmentAssignments(client, {
        userId: id,
        assignedBy: req.auth!.userId,
        departmentId: assignedDepartmentIds[0] ?? null,
        departmentIds: assignedDepartmentIds,
      });

      if (assignedRoleIds.length > 0) {
        for (const roleId of assignedRoleIds) {
          await client.query(
            "INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [id, roleId, req.auth!.userId],
          );
        }
      }

      await syncDepartmentManagerAssignment(client, {
        userId: id,
        assignedBy: req.auth!.userId,
        departmentId: assignedDepartmentIds[0] ?? null,
        departmentIds: assignedDepartmentIds,
        roleId: assignedRoleIds[0] ?? null,
        roleIds: assignedRoleIds,
        isActive: true,
      });

      await client.query("COMMIT");
      const profile = await loadProfileById(id);

      // Log audit event
      await logAudit(
        req.auth!.userId,
        req.profile!.full_name,
        "CREATE",
        "User",
        `Created user: ${body.email} (${body.full_name})`,
      );

      res.status(201).json({ id, email: body.email.toLowerCase(), profile });
    } catch (e: unknown) {
      await client.query("ROLLBACK");
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        (e as { code: string }).code === "23505"
      ) {
        throw new HttpError(400, "Email already in use");
      }
      throw e;
    } finally {
      client.release();
    }
  }),
);

const adminPasswordBody = z.object({
  new_password: z
    .string()
    .min(8)
    .refine(isPasswordPolicyValid, PASSWORD_POLICY_MESSAGE),
});

apiRouter.patch(
  "/admin/users/:userId/password",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_users permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = adminPasswordBody.parse(req.body);
    const newHash = await hashPassword(body.new_password);
    const r = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [newHash, req.params.userId],
    );
    if (r.rowCount === 0) throw new HttpError(404, "User not found");

    // Log audit event
    const { rows: targetUser } = await pool.query(
      `SELECT full_name FROM profiles WHERE id = $1`,
      [req.params.userId],
    );
    const targetName = targetUser[0]?.full_name || "Unknown";

    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "User",
      `Reset password for user: ${targetName}`,
    );

    res.json({ success: true });
  }),
);

apiRouter.post(
  "/admin/users/:userId/signature",
  requireAuth,
  upload.single("signature"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      throw new HttpError(400, "Signature image is required");
    }

    try {
      const signatureDataUrl = await signatureFileToDataUrl(file);
      const result = await pool.query(
        `UPDATE profiles SET signature_url = $1, updated_at = now() WHERE id = $2`,
        [signatureDataUrl, req.params.userId],
      );
      if (result.rowCount === 0) {
        throw new HttpError(404, "User not found");
      }

      await logAudit(
        req.auth!.userId,
        req.profile!.full_name,
        "UPDATE",
        "User",
        "Updated user signature",
      );

      const profile = await loadProfileById(req.params.userId);
      res.json({ profile });
    } finally {
      await deleteUploadedFile(file.path);
    }
  }),
);

const updateUserBody = z.object({
  email: z.string().email().optional(),
  full_name: z.string().min(1).optional(),
  signature_url: z.string().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  department_ids: z.array(z.string().uuid()).optional(),
  role_id: z.string().uuid().nullable().optional(),
  role_ids: z.array(z.string().uuid()).optional(), // Support multiple roles
  is_admin: z.boolean().optional(),
  is_active: z.boolean().optional(),
  unlock_account: z.boolean().optional(),
});

apiRouter.patch(
  "/admin/users/:userId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_users permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = updateUserBody.parse(req.body);

    if (!isAdmin && body.is_admin !== undefined) {
      const { rows } = await pool.query<{ is_admin: boolean }>(
        `SELECT is_admin FROM profiles WHERE id = $1`,
        [req.params.userId],
      );
      if (rows.length === 0) {
        throw new HttpError(404, "User not found");
      }
      if (rows[0].is_admin !== body.is_admin) {
        throw new HttpError(403, "Only admins can change admin access");
      }

      delete body.is_admin;
    }

    // Prevent non-admin users from changing role and permissions for users with admin console access
    if (
      !isAdmin &&
      (body.role_id !== undefined || body.role_ids !== undefined || body.is_admin !== undefined)
    ) {
      // Get the target user's current permissions
      const { rows: targetUserRows } = await pool.query<{
        permissions: string[];
      }>(
        `SELECT COALESCE(
           ARRAY(
             SELECT DISTINCT permission
             FROM (
               SELECT unnest(COALESCE(primary_role.permissions, '{}')) AS permission
               UNION ALL
               SELECT unnest(COALESCE(extra_role.permissions, '{}')) AS permission
               FROM user_roles ur
               JOIN roles extra_role ON extra_role.id = ur.role_id
               WHERE ur.user_id = p.id
             ) collected_permissions
             WHERE permission IS NOT NULL
           ),
           '{}'
         ) AS permissions
         FROM profiles p
         LEFT JOIN roles primary_role ON p.role_id = primary_role.id
         WHERE p.id = $1`,
        [req.params.userId],
      );

      if (targetUserRows.length > 0) {
        const targetUserPermissions = targetUserRows[0].permissions || [];
        const hasAdminConsoleAccess =
          targetUserPermissions.includes("manage_users") ||
          targetUserPermissions.includes("manage_roles") ||
          targetUserPermissions.includes("manage_departments") ||
          targetUserPermissions.includes("manage_approval_types") ||
          targetUserPermissions.includes("manage_chains") ||
          targetUserPermissions.includes("all");

        if (hasAdminConsoleAccess) {
          throw new HttpError(
            403,
            "Only admins can change permissions for users with admin console access",
          );
        }
      }
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: currentProfiles } = await client.query<{
        department_id: string | null;
        role_id: string | null;
        is_active: boolean;
        department_ids: string[] | null;
        role_ids: string[] | null;
      }>(
        `SELECT
           p.department_id,
           p.role_id,
           p.is_active,
           COALESCE(
             ARRAY(
               SELECT DISTINCT department_id
               FROM (
                 SELECT p.department_id
                 UNION ALL
                 SELECT ud.department_id
                 FROM user_departments ud
                 WHERE ud.user_id = p.id
               ) assigned_departments
               WHERE department_id IS NOT NULL
             ),
             '{}'
           ) AS department_ids,
           COALESCE(
             ARRAY(
               SELECT DISTINCT role_id
               FROM (
                 SELECT p.role_id
                 UNION ALL
                 SELECT ur.role_id
                 FROM user_roles ur
                 WHERE ur.user_id = p.id
               ) assigned_roles
               WHERE role_id IS NOT NULL
             ),
             '{}'
           ) AS role_ids
           FROM profiles
          p
          WHERE id = $1
          FOR UPDATE`,
        [req.params.userId],
      );

      if (currentProfiles.length === 0) {
        throw new HttpError(404, "User not found");
      }

      const currentProfile = currentProfiles[0];
      const assignedDepartmentIds = dedupeAssignedIds(
        body.department_id !== undefined ? body.department_id : currentProfile.department_id,
        body.department_ids !== undefined ? body.department_ids : currentProfile.department_ids ?? [],
      );
      const assignedRoleIds = dedupeAssignedIds(
        body.role_id !== undefined ? body.role_id : currentProfile.role_id,
        body.role_ids !== undefined ? body.role_ids : currentProfile.role_ids ?? [],
      );
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (body.email !== undefined) {
        await client.query(
          `UPDATE users SET email = $1, updated_at = now() WHERE id = $2`,
          [body.email.toLowerCase(), req.params.userId],
        );
        updates.push(`email = $${paramIdx}`);
        values.push(body.email.toLowerCase());
        paramIdx++;
      }
      if (body.full_name !== undefined) {
        updates.push(`full_name = $${paramIdx}`);
        values.push(body.full_name.trim());
        paramIdx++;
      }
      if (body.signature_url !== undefined) {
        updates.push(`signature_url = $${paramIdx}`);
        values.push(body.signature_url?.trim() || null);
        paramIdx++;
      }
      if (body.department_id !== undefined || body.department_ids !== undefined) {
        updates.push(`department_id = $${paramIdx}`);
        values.push(assignedDepartmentIds[0] ?? null);
        paramIdx++;
      }
      if (body.role_id !== undefined || body.role_ids !== undefined) {
        updates.push(`role_id = $${paramIdx}`);
        values.push(assignedRoleIds[0] ?? null);
        paramIdx++;
      }
      if (body.is_admin !== undefined) {
        updates.push(`is_admin = $${paramIdx}`);
        values.push(body.is_admin);
        paramIdx++;
      }
      if (body.is_active !== undefined) {
        updates.push(`is_active = $${paramIdx}`);
        values.push(body.is_active);
        paramIdx++;
      }
      if (body.unlock_account === true) {
        updates.push(`is_locked = false`);
        updates.push(`failed_login_attempts = 0`);
        updates.push(`locked_at = null`);
        updates.push(`last_failed_login_at = null`);
      }

      if (updates.length === 0 && body.role_ids === undefined && body.department_ids === undefined) {
        throw new HttpError(400, "No fields to update");
      }

      updates.push(`updated_at = now()`);

      const r = await client.query(
        `UPDATE profiles SET ${updates.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
        [...values, req.params.userId],
      );

      if (r.rowCount === 0) throw new HttpError(404, "User not found");

      if (body.department_ids !== undefined || body.department_id !== undefined) {
        await syncUserDepartmentAssignments(client, {
          userId: req.params.userId,
          assignedBy: req.auth!.userId,
          departmentId: assignedDepartmentIds[0] ?? null,
          departmentIds: assignedDepartmentIds,
        });
      }

      if (body.role_ids !== undefined || body.role_id !== undefined) {
        await client.query("DELETE FROM user_roles WHERE user_id = $1", [req.params.userId]);
        for (const roleId of assignedRoleIds) {
          await client.query(
            "INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [req.params.userId, roleId, req.auth!.userId],
          );
        }
      }

      await syncDepartmentManagerAssignment(client, {
        userId: req.params.userId,
        assignedBy: req.auth!.userId,
        departmentId: assignedDepartmentIds[0] ?? null,
        departmentIds: assignedDepartmentIds,
        roleId: assignedRoleIds[0] ?? null,
        roleIds: assignedRoleIds,
        isActive:
          body.is_active !== undefined ? body.is_active : currentProfile.is_active,
      });

      await client.query("COMMIT");

      // Log audit event
      const targetUser = r.rows[0];
      const changes: string[] = [];
      if (body.email !== undefined)
        changes.push(`email: "${body.email.toLowerCase()}"`);
      if (body.full_name !== undefined)
        changes.push(`full_name: "${body.full_name}"`);
      if (body.signature_url !== undefined)
        changes.push("signature updated");
      if (body.department_id !== undefined || body.department_ids !== undefined)
        changes.push(`departments: [${assignedDepartmentIds.join(", ")}]`);
      if (body.role_id !== undefined || body.role_ids !== undefined)
        changes.push(`roles: [${assignedRoleIds.join(", ")}]`);
      if (body.is_admin !== undefined) changes.push(`is_admin: ${body.is_admin}`);
      if (body.is_active !== undefined)
        changes.push(`is_active: ${body.is_active}`);
      if (body.unlock_account === true) changes.push(`unlocked account`);

      await logAudit(
        req.auth!.userId,
        req.profile!.full_name,
        "UPDATE",
        "User",
        `Updated user ${targetUser.full_name}: ${changes.join(", ")}`,
      );

      const profile = await loadProfileById(req.params.userId);
      res.json({ profile });
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code: string }).code === "23505"
      ) {
        throw new HttpError(400, "Email already in use");
      }
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.delete(
  "/admin/users/:userId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    // Check if user has admin access or manage_users permission
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Get user info before deletion for audit logging
      const { rows: targetUser } = await client.query(
        `SELECT full_name FROM profiles WHERE id = $1`,
        [req.params.userId],
      );
      const targetName = targetUser[0]?.full_name || "Unknown";

      // Delete approval actions where user acted
      await client.query(`DELETE FROM approval_actions WHERE acted_by = $1`, [
        req.params.userId,
      ]);
      // Delete approval requests initiated by user
      await client.query(
        `DELETE FROM approval_requests WHERE initiator_id = $1`,
        [req.params.userId],
      );
      // Delete profile
      const profileRes = await client.query(
        `DELETE FROM profiles WHERE id = $1 RETURNING id`,
        [req.params.userId],
      );
      if (profileRes.rowCount === 0) {
        throw new HttpError(404, "User not found");
      }
      // Delete user account
      await client.query(`DELETE FROM users WHERE id = $1`, [
        req.params.userId,
      ]);
      await client.query("COMMIT");

      // Log audit event
      await logAudit(
        req.auth!.userId,
        req.profile!.full_name,
        "DELETE",
        "User",
        `Deleted user: ${targetName}`,
      );

      res.json({ success: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }),
);

// User Roles Management (Multiple Roles Per User)
apiRouter.get(
  "/admin/users/:userId/roles",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.description, r.permissions
       FROM roles r
       JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1
       ORDER BY r.name`,
      [req.params.userId],
    );

    res.json({ roles: rows });
  }),
);

apiRouter.post(
  "/admin/users/:userId/roles",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const body = z.object({
      role_id: z.string().uuid(),
    }).parse(req.body);

    // Check if role exists
    const roleCheck = await pool.query(
      "SELECT id FROM roles WHERE id = $1",
      [body.role_id],
    );
    if (roleCheck.rowCount === 0) {
      throw new HttpError(404, "Role not found");
    }

    // Check if user exists
    const userCheck = await pool.query(
      "SELECT id FROM profiles WHERE id = $1",
      [req.params.userId],
    );
    if (userCheck.rowCount === 0) {
      throw new HttpError(404, "User not found");
    }

    // Add role to user
    try {
      await pool.query(
        "INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [req.params.userId, body.role_id, req.auth!.userId],
      );
    } catch (e) {
      throw new HttpError(400, "Failed to assign role");
    }

    // Get user info for audit
    const userRes = await pool.query(
      "SELECT full_name FROM profiles WHERE id = $1",
      [req.params.userId],
    );
    const userName = userRes.rows[0]?.full_name || "Unknown";

    // Get role name for audit
    const roleRes = await pool.query(
      "SELECT name FROM roles WHERE id = $1",
      [body.role_id],
    );
    const roleName = roleRes.rows[0]?.name || "Unknown";

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "User",
      `Assigned role "${roleName}" to user ${userName}`,
    );

    res.json({ success: true });
  }),
);

apiRouter.delete(
  "/admin/users/:userId/roles/:roleId",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("manage_users") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    // Remove role from user
    const result = await pool.query(
      "DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2",
      [req.params.userId, req.params.roleId],
    );

    if (result.rowCount === 0) {
      throw new HttpError(404, "User role assignment not found");
    }

    // Get user info for audit
    const userRes = await pool.query(
      "SELECT full_name FROM profiles WHERE id = $1",
      [req.params.userId],
    );
    const userName = userRes.rows[0]?.full_name || "Unknown";

    // Get role name for audit
    const roleRes = await pool.query(
      "SELECT name FROM roles WHERE id = $1",
      [req.params.roleId],
    );
    const roleName = roleRes.rows[0]?.name || "Unknown";

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "User",
      `Removed role "${roleName}" from user ${userName}`,
    );

    res.json({ success: true });
  }),
);

// Approval requests
apiRouter.get(
  "/approval-requests",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const admin = req.profile!.is_admin;
    const uid = req.auth!.userId;
    const userPermissions = req.profile!.permissions || [];

    const canApprove =
      userPermissions.includes("approve_reject") ||
      userPermissions.includes("all");

    // Final visibility is enforced in the query below, including work assignees.
    const hasListAccess = true;

    if (!hasListAccess) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to view approval requests",
      );
    }

    // Build the visibility scope.
    // Visibility model:
    //   * Initiators always see their own requests.
    //   * Department-scope viewers see requests originating from their department
    //     OR departments they manage.
    //   * Org-wide viewers / admins see everything.
    //   * Approvers ALWAYS see requests where they are (or were) the assigned
    //     approver, regardless of view permission. This is the fix for the
    //     "approving authority sees nothing" bug.
    let scopeClause = "";
    const queryParams: unknown[] = [uid];

    if (admin || userPermissions.includes("view_all_requests") || userPermissions.includes("all")) {
      scopeClause = "TRUE";
    } else if (userPermissions.includes("view_department_requests")) {
      scopeClause = `(
        ar.initiator_id = $1
        OR ar.department_id IN (
          SELECT department_id FROM profiles WHERE id = $1
          UNION
          SELECT department_id FROM user_departments WHERE user_id = $1
        )
        OR ar.department_id IN (
          SELECT department_id FROM department_managers
           WHERE user_id = $1 AND is_active = true
        )
      )`;
    } else if (
      userPermissions.includes("view_own_requests") ||
      userPermissions.includes("initiate_request")
    ) {
      scopeClause = "ar.initiator_id = $1";
    } else {
      scopeClause = "FALSE";
    }

    // Approver visibility:
    //   only requests where this user is the concrete assignee for a step
    //   or has already acted on a step. Shared-role visibility is intentionally
    //   not allowed because it causes request mixing across users.
    const approverVisibility = `EXISTS (
      SELECT 1 FROM approval_actions aa
       WHERE aa.request_id = ar.id
         AND (aa.approver_user_id = $1 OR aa.acted_by = $1)
    ) OR ar.work_assignee_id = $1`;

    const whereCombined = `(${scopeClause} OR ${approverVisibility})`;

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (ar.id) ar.*,
        json_build_object('name', at.name) AS approval_types,
        json_build_object('name', d.name) AS departments,
        (ar.initiator_id = $1) AS is_initiator,
        (
          EXISTS (
            SELECT 1 FROM approval_actions aa
             WHERE aa.request_id = ar.id
               AND aa.approver_user_id = $1
               AND aa.status = 'pending'
          )
        ) AS needs_approval,
        (
          EXISTS (
            SELECT 1 FROM approval_actions aa
             WHERE aa.request_id = ar.id
               AND aa.acted_by = $1
          )
        ) AS has_acted,
        (
          SELECT aa.role_name FROM approval_actions aa
           WHERE aa.request_id = ar.id
             AND aa.status IN ('pending', 'waiting')
           ORDER BY aa.step_order ASC
           LIMIT 1
        ) AS current_step_role
      FROM approval_requests ar
      LEFT JOIN approval_types at ON at.id = ar.approval_type_id
      LEFT JOIN departments d ON d.id = ar.department_id
      WHERE ${whereCombined}
      ORDER BY ar.id, ar.created_at DESC`,
      queryParams,
    );
    res.json(rows);
  }),
);

apiRouter.get(
  "/approval-requests/assignees",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const rawDepartmentId =
      typeof req.query.department_id === "string" ? req.query.department_id.trim() : "";
    const departmentId =
      rawDepartmentId === "all"
        ? null
        : rawDepartmentId !== ""
          ? rawDepartmentId
          : req.profile?.department_id ?? null;

    const assignees = await listEligibleWorkAssignees(pool, {
      departmentId,
    });

    res.json(assignees);
  }),
);

apiRouter.get(
  "/approval-requests/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const admin = req.profile!.is_admin;
    const uid = req.auth!.userId;
    const userPermissions = req.profile!.permissions || [];

    const canApprove =
      userPermissions.includes("approve_reject") ||
      userPermissions.includes("all");

    // Final visibility is enforced in the query below, including work assignees.
    const hasDetailAccess = true;

    if (!hasDetailAccess) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to view approval requests",
      );
    }

    let scopeClause = "";
    const queryParams: unknown[] = [req.params.id, uid];

    if (admin || userPermissions.includes("view_all_requests") || userPermissions.includes("all")) {
      scopeClause = "ar.id = $1";
    } else if (userPermissions.includes("view_department_requests")) {
      scopeClause = `ar.id = $1 AND (
        ar.initiator_id = $2
        OR ar.department_id IN (
          SELECT department_id FROM profiles WHERE id = $2
          UNION
          SELECT department_id FROM user_departments WHERE user_id = $2
        )
        OR ar.department_id IN (
          SELECT department_id FROM department_managers
           WHERE user_id = $2 AND is_active = true
        )
      )`;
    } else if (
      userPermissions.includes("view_own_requests") ||
      userPermissions.includes("initiate_request")
    ) {
      scopeClause = "ar.id = $1 AND ar.initiator_id = $2";
    } else {
      scopeClause = "ar.id = $1 AND FALSE";
    }

    const approverVisibility = `ar.id = $1 AND EXISTS (
      SELECT 1 FROM approval_actions aa
       WHERE aa.request_id = ar.id
         AND (aa.approver_user_id = $2 OR aa.acted_by = $2)
    )`;
    const workAssigneeVisibility = "ar.id = $1 AND ar.work_assignee_id = $2";

    const { rows } = await pool.query(
      `SELECT ar.*,
        json_build_object(
          'name', at.name,
          'description', at.description,
          'fields', at.fields,
          'page_layout', at.page_layout,
          'allow_attachments', at.allow_attachments
        ) AS approval_types,
        json_build_object('name', d.name) AS departments,
        json_build_object(
          'full_name', ip.full_name,
          'signature_url', ip.signature_url
        ) AS initiator,
        json_build_object(
          'id', wa.id,
          'full_name', wa.full_name,
          'email', wa.email
        ) AS work_assignee,
        json_build_object(
          'id', wb.id,
          'full_name', wb.full_name
        ) AS work_completed_by_profile,
        (
          SELECT acted_by
            FROM approval_actions aa
           WHERE aa.request_id = ar.id
             AND aa.status = 'approved'
           ORDER BY aa.step_order DESC, aa.acted_at DESC NULLS LAST, aa.created_at DESC
           LIMIT 1
        ) AS final_authority_user_id
      FROM approval_requests ar
      LEFT JOIN approval_types at ON at.id = ar.approval_type_id
      LEFT JOIN departments d ON d.id = ar.department_id
      LEFT JOIN profiles ip ON ip.id = ar.initiator_id
      LEFT JOIN profiles wa ON wa.id = ar.work_assignee_id
      LEFT JOIN profiles wb ON wb.id = ar.work_completed_by
      WHERE (${scopeClause}) OR (${approverVisibility}) OR (${workAssigneeVisibility})
      LIMIT 1`,
      queryParams,
    );
    if (rows.length === 0) throw new HttpError(404, "Not found");
    const { rows: actions } = await pool.query(
      `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [req.params.id],
    );
    const actorIds = [
      ...new Set(
        actions
          .map((a: { acted_by: string | null }) => a.acted_by)
          .filter(Boolean),
      ),
    ] as string[];
    const actorNames: Record<string, string> = {};
    const actorProfiles: Record<
      string,
      { full_name: string; signature_url: string | null; department_name: string | null }
    > = {};
    if (actorIds.length > 0) {
      const { rows: actors } = await pool.query<{
        id: string;
        full_name: string;
        signature_url: string | null;
        department_name: string | null;
      }>(
        `SELECT p.id, p.full_name, p.signature_url, d.name AS department_name
           FROM profiles p
           LEFT JOIN departments d ON d.id = p.department_id
          WHERE p.id = ANY($1::uuid[])`,
        [actorIds],
      );
      for (const a of actors) {
        actorNames[a.id] = a.full_name;
        actorProfiles[a.id] = {
          full_name: a.full_name,
          signature_url: a.signature_url,
          department_name: a.department_name,
        };
      }
    }
    res.json({ request: rows[0], actions, actorNames, actorProfiles });
  }),
);

apiRouter.get(
  "/approval-requests/by-number/:num",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const admin = req.profile!.is_admin;
    const uid = req.auth!.userId;
    const { rows } = await pool.query(
      `SELECT ar.id FROM approval_requests ar
        WHERE ar.request_number = $1 AND (
          $2::boolean
          OR ar.initiator_id = $3
          OR EXISTS (
            SELECT 1 FROM approval_actions aa
             WHERE aa.request_id = ar.id
               AND (aa.approver_user_id = $3 OR aa.acted_by = $3)
          )
        )`,
      [req.params.num, admin, uid],
    );
    if (rows.length === 0) throw new HttpError(404, "Not found");
    res.json({ id: rows[0].id });
  }),
);

const createRequestBody = z.object({
  approval_type_id: z.string().uuid(),
  approval_chain_id: z.string().uuid().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  form_data: z.record(z.string(), z.any()),
  current_step: z.number().int(),
  total_steps: z.number().int(),
  status: z.enum(["pending", "in_progress", "approved", "rejected"]),
});

apiRouter.post(
  "/approval-requests",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const userPermissions = req.profile!.permissions || [];
    const isAdmin = req.profile!.is_admin;
    const canChooseDepartment =
      isAdmin ||
      userPermissions.includes("manage_departments") ||
      userPermissions.includes("all");

    // Check if user has permission to initiate requests
    const canInitiate =
      userPermissions.includes("initiate_request") ||
      userPermissions.includes("all");

    if (!canInitiate && !isAdmin) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to create approval requests",
      );
    }

    const body = createRequestBody.parse(req.body);
    const uid = req.auth!.userId;

    if (!body.approval_chain_id) {
      throw new HttpError(400, "Approval chain is required");
    }

    const { rows: typeRows } = await pool.query<{ department_id: string | null }>(
      `SELECT department_id FROM approval_types WHERE id = $1`,
      [body.approval_type_id],
    );
    if (typeRows.length === 0) {
      throw new HttpError(404, "Approval type not found");
    }

    const profileDepartmentId = req.profile?.department_id ?? null;
    const selectedDeptId = canChooseDepartment
      ? body.department_id ?? profileDepartmentId
      : profileDepartmentId;

    if (
      !canChooseDepartment &&
      body.department_id !== undefined &&
      body.department_id !== profileDepartmentId
    ) {
      throw new HttpError(
        403,
        "You can only create requests for your own department",
      );
    }

    const requestDeptId = selectedDeptId ?? profileDepartmentId ?? null;

    if (!requestDeptId) {
      throw new HttpError(
        400,
        "Requests must originate from a specific department",
      );
    }

    // Resolve chain steps up-front so we can populate approval_actions atomically.
    let chainSteps: WorkflowStepDefinition[] = [];
    if (body.approval_chain_id) {
      const { rows: chainRows } = await pool.query<{ steps: unknown }>(
        `SELECT steps FROM approval_chains WHERE id = $1`,
        [body.approval_chain_id],
      );
      if (chainRows.length === 0) {
        throw new HttpError(404, "Approval chain not found");
      }
      const raw = chainRows[0].steps;
      chainSteps = normalizeWorkflowSteps(
        Array.isArray(raw)
          ? raw
          : typeof raw === "string"
            ? JSON.parse(raw)
            : [],
      );
      if (chainSteps.length === 0) {
        throw new HttpError(400, "Approval chain has no steps configured");
      }
    }

    const client = await pool.connect();
    let createdRequest: Record<string, unknown>;
    try {
      await client.query("BEGIN");
      const chainWorkAssigneeId = await resolveChainWorkAssigneeId(client, {
        approvalChainId: body.approval_chain_id,
      });

      if (!chainWorkAssigneeId) {
        throw new HttpError(400, "No work assignee is configured on the selected approval chain");
      }

      const ins = await client.query(
        `INSERT INTO approval_requests (
          approval_type_id, approval_chain_id, initiator_id, department_id,
          form_data, current_step, total_steps, status, work_status,
          work_assignee_id, work_assigned_by, work_assigned_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, now())
        RETURNING *`,
        [
          body.approval_type_id,
          body.approval_chain_id ?? null,
          uid,
          requestDeptId,
          JSON.stringify(body.form_data),
          1,
          chainSteps.length || body.total_steps,
          chainSteps.length > 0 ? "in_progress" : body.status,
          "pending",
          chainWorkAssigneeId,
          uid,
        ],
      );
      createdRequest = ins.rows[0];

      if (chainSteps.length > 0) {
        await generateApprovalActionsForRequest(client, {
          requestId: createdRequest.id as string,
          chainSteps,
          request: {
            requestId: createdRequest.id as string,
            initiatorId: uid,
            departmentId: requestDeptId,
            formData: body.form_data,
          },
        });
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Log audit event
    await logAudit(
      uid,
      req.profile!.full_name,
      "CREATE",
      "Approval Request",
      `Created approval request: ${createdRequest.request_number}`,
    );

    await emailNotificationService.notifyRequestSubmitted(
      createdRequest.id as string,
    );

    res.status(201).json(createdRequest);
  }),
);

// Approve an approval request
const actionBody = z.object({
  comment: z.string().optional(),
});

const rejectActionBody = z.object({
  comment: z
    .string()
    .trim()
    .min(1, "A rejection reason is required"),
});

const assignWorkBody = z.object({
  assignee_id: z.string().uuid(),
});

const workStatusBody = z.object({
  status: z.enum(["assigned", "in_progress", "done", "not_done"]),
  comment: z.string().optional(),
});

apiRouter.post(
  "/approval-requests/:id/approve",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = actionBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const userPermissions = req.profile!.permissions || [];
    const isAdmin = req.profile!.is_admin;

    const canApproveReject =
      userPermissions.includes("approve_reject") ||
      userPermissions.includes("all");

    if (!canApproveReject && !isAdmin) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to approve requests",
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: lockedRequests } = await client.query(
        `SELECT * FROM approval_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      if (lockedRequests.length === 0) {
        throw new HttpError(404, "Request not found");
      }

      const lockedRequest = lockedRequests[0];
      if (lockedRequest.initiator_id === userId) {
        throw new HttpError(403, "You cannot approve your own request");
      }

      const currentAction = await findActionableStep(client, {
        requestId,
        userId,
        isAdmin,
      });
      if (!currentAction) {
        throw new HttpError(
          403,
          "You are not the assigned approver for the active step on this request",
        );
      }

      await client.query(
        `UPDATE approval_actions
            SET status = 'approved', acted_by = $1, acted_at = now(), comment = $2
          WHERE id = $3`,
        [userId, body.comment || null, currentAction.id],
      );
      await syncRequestStepAction(client, {
        requestId,
        stepOrder: Number(currentAction.step_order),
        userId,
        status: "APPROVED",
        comment: body.comment,
      });

      // Promote any next-step waiting actions to pending so the next approver(s) can act.
      await client.query(
        `UPDATE approval_actions
            SET status = 'pending'
          WHERE request_id = $1
            AND status = 'waiting'
            AND step_order = (
              SELECT MIN(step_order) FROM approval_actions
                WHERE request_id = $1 AND status = 'waiting'
            )`,
        [requestId],
      );
      await promoteNextRequestStep(client, requestId);

      const { rows: allActions } = await client.query<{ status: string; step_order: number }>(
        `SELECT status, step_order FROM approval_actions WHERE request_id = $1`,
        [requestId],
      );
      const remaining = allActions.filter((a) =>
        ["pending", "waiting"].includes(a.status),
      );
      const newStatus = remaining.length === 0 ? "approved" : "in_progress";
      const newCurrentStep =
        remaining.length === 0
          ? lockedRequest.current_step
          : Math.min(...remaining.map((a) => a.step_order));

      await client.query(
        `UPDATE approval_requests
            SET status = $1, current_step = $2, updated_at = now()
          WHERE id = $3`,
        [newStatus, newCurrentStep, requestId],
      );

      if (newStatus === "approved") {
        await client.query(
          `UPDATE approval_requests
              SET work_status = 'assigned',
                  work_assigned_at = COALESCE(work_assigned_at, now()),
                  updated_at = now()
            WHERE id = $1`,
          [requestId],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const { rows: updatedRequests } = await pool.query(
      `SELECT * FROM approval_requests WHERE id = $1`,
      [requestId],
    );
    const { rows: updatedActions } = await pool.query(
      `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [requestId],
    );

    await logAudit(
      userId,
      req.profile!.full_name,
      "APPROVE",
      "Approval Request",
      `Approved request: ${updatedRequests[0].request_number}`,
    );

    await emailNotificationService.notifyRequestApproved(
      requestId,
      req.profile!.full_name,
      body.comment,
    );

    if (updatedRequests[0]?.status === "approved" && updatedRequests[0]?.work_assignee_id) {
      await emailNotificationService.notifyWorkAssigned(
        requestId,
        req.profile!.full_name,
      );
    }

    res.json({ request: updatedRequests[0], actions: updatedActions });
  }),
);

// Reject an approval request
apiRouter.post(
  "/approval-requests/:id/reject",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = rejectActionBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const userPermissions = req.profile!.permissions || [];
    const isAdmin = req.profile!.is_admin;

    const canApproveReject =
      userPermissions.includes("approve_reject") ||
      userPermissions.includes("all");

    if (!canApproveReject && !isAdmin) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to reject requests",
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: lockedRequests } = await client.query(
        `SELECT * FROM approval_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      if (lockedRequests.length === 0) {
        throw new HttpError(404, "Request not found");
      }
      const lockedRequest = lockedRequests[0];
      if (lockedRequest.initiator_id === userId) {
        throw new HttpError(403, "You cannot reject your own request");
      }

      const currentAction = await findActionableStep(client, {
        requestId,
        userId,
        isAdmin,
      });
      if (!currentAction) {
        throw new HttpError(
          403,
          "You are not the assigned approver for the active step on this request",
        );
      }
      await client.query(
        `UPDATE approval_actions
            SET status = 'rejected', acted_by = $1, acted_at = now(), comment = $2
          WHERE id = $3`,
        [userId, body.comment, currentAction.id],
      );
      await syncRequestStepAction(client, {
        requestId,
        stepOrder: Number(currentAction.step_order),
        userId,
        status: "REJECTED",
        comment: body.comment,
      });
      // Skip remaining open steps once rejected.
      await client.query(
        `UPDATE approval_actions
            SET status = 'skipped'
          WHERE request_id = $1 AND status IN ('pending', 'waiting')`,
        [requestId],
      );
      await client.query(
        `UPDATE request_steps
            SET status = 'SKIPPED'
          WHERE request_id = $1
            AND status IN ('PENDING', 'WAITING')`,
        [requestId],
      );
      await client.query(
        `UPDATE approval_requests
            SET status = 'rejected', updated_at = now()
          WHERE id = $1`,
        [requestId],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const { rows: updatedRequests } = await pool.query(
      `SELECT * FROM approval_requests WHERE id = $1`,
      [requestId],
    );
    const { rows: updatedActions } = await pool.query(
      `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [requestId],
    );

    await logAudit(
      userId,
      req.profile!.full_name,
      "REJECT",
      "Approval Request",
      `Rejected request: ${updatedRequests[0].request_number}`,
    );

    await emailNotificationService.notifyRequestRejected(
      requestId,
      req.profile!.full_name,
      body.comment,
    );

    res.json({ request: updatedRequests[0], actions: updatedActions });
  }),
);

apiRouter.post(
  "/approval-requests/:id/assign-work",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = assignWorkBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const isAdmin = req.profile!.is_admin;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: requests } = await client.query<{
        id: string;
        request_number: string;
        status: string;
        initiator_id: string;
        department_id: string | null;
      }>(
        `SELECT id, request_number, status, initiator_id, department_id
           FROM approval_requests
          WHERE id = $1
          FOR UPDATE`,
        [requestId],
      );
      const request = requests[0];
      if (!request) {
        throw new HttpError(404, "Request not found");
      }
      if (request.status !== "approved") {
        throw new HttpError(400, "Work can only be assigned after final approval");
      }

      const finalAuthorityUserId = await getFinalAuthorityUserId(client, requestId);
      if (!isAdmin && finalAuthorityUserId !== userId) {
        throw new HttpError(
          403,
          "Only the final approving authority or an admin can assign the approved work",
        );
      }

      const assignee = await ensureEligibleWorkAssignee(client, {
        departmentId: null,
        excludeUserId: request.initiator_id,
        assigneeId: body.assignee_id,
      });

      const { rows: updatedRequests } = await client.query(
        `UPDATE approval_requests
            SET work_assignee_id = $1,
                work_assigned_by = $2,
                work_assigned_at = now(),
                work_status = 'assigned',
                work_completed_by = NULL,
                work_completed_at = NULL,
                updated_at = now()
          WHERE id = $3
          RETURNING *`,
        [assignee.id, userId, requestId],
      );

      await client.query("COMMIT");

      await logAudit(
        userId,
        req.profile!.full_name,
        "ASSIGN_WORK",
        "Approval Request",
        `Assigned approved request ${request.request_number} to ${assignee.full_name}`,
      );

      await emailNotificationService.notifyWorkAssigned(
        requestId,
        req.profile!.full_name,
      );

      res.json(updatedRequests[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.post(
  "/approval-requests/:id/work-status",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = workStatusBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const isAdmin = req.profile!.is_admin;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: requests } = await client.query<{
        id: string;
        request_number: string;
        status: string;
        work_assignee_id: string | null;
        work_status: string;
        work_completed_at: string | null;
      }>(
        `SELECT id, request_number, status, work_assignee_id, work_status, work_completed_at
           FROM approval_requests
          WHERE id = $1
          FOR UPDATE`,
        [requestId],
      );
      const request = requests[0];
      if (!request) {
        throw new HttpError(404, "Request not found");
      }
      if (request.status !== "approved") {
        throw new HttpError(400, "Only approved requests can have work status updates");
      }
      if (!request.work_assignee_id) {
        throw new HttpError(400, "Assign the approved work before updating its status");
      }
      if (!isAdmin && request.work_assignee_id !== userId) {
        throw new HttpError(403, "Only the assigned worker can update this work status");
      }

      const { rows: updatedRequests } = await client.query(
        `UPDATE approval_requests
            SET work_status = $1,
                work_completed_by = CASE WHEN $1 = 'done' THEN $2::uuid ELSE NULL::uuid END,
                work_completed_at = CASE WHEN $1 = 'done' THEN now() ELSE NULL END,
                updated_at = now()
          WHERE id = $3
          RETURNING *`,
        [body.status, userId, requestId],
      );

      await client.query("COMMIT");

      await logAudit(
        userId,
        req.profile!.full_name,
        "UPDATE_WORK_STATUS",
        "Approval Request",
        `Updated work status for ${request.request_number} to ${body.status}`,
      );

      await emailNotificationService.notifyWorkStatusUpdated(
        requestId,
        req.profile!.full_name,
        body.status,
        body.comment,
      );

      res.json(updatedRequests[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

// Request changes on an approval request
apiRouter.post(
  "/approval-requests/:id/request-changes",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    throw new HttpError(
      410,
      "Request changes has been removed. Assigned approvers can edit the request directly instead.",
    );
  }),
);

// Update request form data (assigned approver/admin only)
const updateRequestBody = z.object({
  form_data: z.record(z.any()),
  comment: z.string().optional(),
});

apiRouter.delete(
  "/approval-requests/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const isAdmin = req.profile!.is_admin;
    const userPermissions = req.profile!.permissions || [];
    const hasDeletePermission =
      userPermissions.includes("delete_initiated_requests") ||
      userPermissions.includes("all");

    const { rows: requests } = await pool.query<{
      id: string;
      request_number: string;
      initiator_id: string;
      status: string;
    }>(
      `SELECT id, request_number, initiator_id, status
         FROM approval_requests
        WHERE id = $1`,
      [requestId],
    );

    if (requests.length === 0) {
      throw new HttpError(404, "Request not found");
    }

    const request = requests[0];
    const isInitiator = request.initiator_id === userId;

    if (!isAdmin && !hasDeletePermission) {
      throw new HttpError(
        403,
        "Only admins or users with delete request permission can delete this request",
      );
    }

    if (request.status === "approved" || request.status === "rejected") {
      throw new HttpError(
        400,
        "Completed requests cannot be deleted",
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: attachments } = await client.query<{ file_path: string | null }>(
        `SELECT file_path
           FROM request_attachments
          WHERE request_id = $1`,
        [requestId],
      );

      await client.query(`DELETE FROM request_attachments WHERE request_id = $1`, [requestId]);
      await client.query(`DELETE FROM request_steps WHERE request_id = $1`, [requestId]);
      await client.query(`DELETE FROM approval_actions WHERE request_id = $1`, [requestId]);
      await client.query(`DELETE FROM approval_requests WHERE id = $1`, [requestId]);

      await client.query("COMMIT");

      for (const attachment of attachments) {
        if (attachment.file_path && isFileInsideUploads(attachment.file_path)) {
          try {
            await deleteUploadedFile(attachment.file_path);
          } catch {
            // Best effort cleanup after DB deletion succeeds.
          }
        }
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await logAudit(
      userId,
      req.profile!.full_name,
      "DELETE",
      "Approval Request",
      `Deleted request: ${request.request_number}`,
    );

    res.json({ success: true });
  }),
);

apiRouter.patch(
  "/approval-requests/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = updateRequestBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const isAdmin = req.profile!.is_admin;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const { rows: requests } = await client.query(
        `SELECT ar.* FROM approval_requests ar WHERE ar.id = $1 FOR UPDATE`,
        [requestId],
      );
      if (requests.length === 0) throw new HttpError(404, "Request not found");
      const request = requests[0];

      const currentAction = await findActionableStep(client, {
        requestId,
        userId,
        isAdmin,
      });
      const canEditAsApprover =
        Boolean(currentAction) &&
        ["pending", "in_progress"].includes(request.status);

      if (!isAdmin && !canEditAsApprover) {
        throw new HttpError(
          403,
          "Only an admin or the assigned approver for the current step can update this request",
        );
      }

      if (request.status === "approved" || request.status === "rejected") {
        throw new HttpError(
          400,
          "Completed requests cannot be updated",
        );
      }

      if (!["pending", "in_progress"].includes(request.status)) {
        throw new HttpError(
          400,
          "Only requests in pending or in_progress can be updated",
        );
      }

      const previousFormData =
        typeof request.form_data === "string"
          ? JSON.parse(request.form_data)
          : request.form_data;

      const targetStatus =
        request.status === "pending" ? "in_progress" : request.status;
      const { rows: updatedRequests } = await client.query(
        `UPDATE approval_requests
            SET form_data = $1::jsonb, status = $2, updated_at = now()
          WHERE id = $3
          RETURNING *`,
        [JSON.stringify(body.form_data), targetStatus, requestId],
      );

      const editedByApprover = !isAdmin;
      if (editedByApprover && currentAction) {
        const historyComment = buildEditHistoryComment({
          previousData:
            (previousFormData as Record<string, unknown> | null) ?? {},
          nextData: body.form_data,
          editorNote: body.comment,
        });

        await client.query(
          `INSERT INTO approval_actions (
            request_id,
            step_order,
            role_name,
            action_label,
            status,
            approver_user_id,
            acted_by,
            acted_at,
            comment
          ) VALUES ($1, $2, $3, $4, 'edited', $5, $6, now(), $7)`,
          [
            requestId,
            Number(currentAction.step_order),
            String(currentAction.role_name ?? "Approval Step"),
            "Edited Request",
            currentAction.approver_user_id ?? userId,
            userId,
            historyComment,
          ],
        );
      }

      await client.query("COMMIT");

      const { rows: updatedActions } = await pool.query(
        `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
        [requestId],
      );

      const auditLabel = editedByApprover
        ? `Edited request contents during approval: ${updatedRequests[0].request_number}`
        : `Updated request: ${updatedRequests[0].request_number}`;

      await logAudit(
        userId,
        req.profile!.full_name,
        editedByApprover ? "EDIT" : "UPDATE",
        "Approval Request",
        auditLabel,
      );

      if (editedByApprover) {
        await emailNotificationService.notifyChangesRequested(
          requestId,
          req.profile!.full_name,
          body.comment,
        );
      }

      res.json({ request: updatedRequests[0], actions: updatedActions });
      return;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

apiRouter.get(
  "/audit-logs",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const isAdmin = req.profile?.is_admin;
    const hasPermission =
      req.profile?.permissions?.includes("view_audit_logs") ||
      req.profile?.permissions?.includes("all");

    if (!isAdmin && !hasPermission) {
      throw new HttpError(403, "Forbidden");
    }

    const { rows } = await pool.query(
      `SELECT * FROM audit_logs ORDER BY created_at DESC`,
    );
    res.json(rows);
  }),
);

async function loadProfileById(id: string) {
  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.full_name,
       p.email,
       p.signature_url,
       p.department_id,
       p.role_id,
       p.is_admin,
       p.is_active,
       p.created_at,
       p.updated_at,
       p.failed_login_attempts,
       p.is_locked,
       p.locked_at,
       p.last_failed_login_at,
       COALESCE(
         ARRAY(
           SELECT DISTINCT department_id
           FROM (
             SELECT p.department_id
             UNION ALL
             SELECT ud.department_id
             FROM user_departments ud
             WHERE ud.user_id = p.id
           ) assigned_departments
           WHERE department_id IS NOT NULL
         ),
         '{}'
       ) AS department_ids,
       COALESCE(
         ARRAY(
           SELECT DISTINCT role_id
           FROM (
             SELECT p.role_id
             UNION ALL
             SELECT ur.role_id
             FROM user_roles ur
             WHERE ur.user_id = p.id
           ) assigned_roles
           WHERE role_id IS NOT NULL
         ),
         '{}'
       ) AS role_ids,
       COALESCE(
         ARRAY(
           SELECT DISTINCT department_name
           FROM (
             SELECT d.name AS department_name
             UNION ALL
             SELECT extra_department.name AS department_name
             FROM user_departments ud
             JOIN departments extra_department ON extra_department.id = ud.department_id
             WHERE ud.user_id = p.id
           ) assigned_department_names
           WHERE department_name IS NOT NULL
         ),
         '{}'
       ) AS department_names,
       COALESCE(
         ARRAY(
           SELECT DISTINCT role_name
           FROM (
             SELECT primary_role.name AS role_name
             UNION ALL
             SELECT extra_role.name AS role_name
             FROM user_roles ur
             JOIN roles extra_role ON extra_role.id = ur.role_id
             WHERE ur.user_id = p.id
           ) assigned_role_names
           WHERE role_name IS NOT NULL
         ),
         '{}'
       ) AS role_names,
       COALESCE(
         ARRAY(
           SELECT DISTINCT permission
           FROM (
             SELECT unnest(COALESCE(primary_role.permissions, '{}')) AS permission
             UNION ALL
             SELECT unnest(COALESCE(extra_role.permissions, '{}')) AS permission
             FROM user_roles ur
             JOIN roles extra_role ON extra_role.id = ur.role_id
             WHERE ur.user_id = p.id
           ) collected_permissions
           WHERE permission IS NOT NULL
         ),
         '{}'
       ) AS permissions,
       primary_role.name AS role_name,
       d.name AS department_name
     FROM profiles p
     LEFT JOIN roles primary_role ON p.role_id = primary_role.id
     LEFT JOIN departments d ON p.department_id = d.id
     WHERE p.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...row,
    permissions: row.permissions || [],
  };
}
