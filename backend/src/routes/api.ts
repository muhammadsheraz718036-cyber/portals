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

export const apiRouter = Router();
const uploadsRoot = path.resolve(process.cwd(), "uploads");

function sanitizeDownloadFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "_");
}

function isFileInsideUploads(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return (
    resolved === uploadsRoot || resolved.startsWith(`${uploadsRoot}${path.sep}`)
  );
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
});

apiRouter.patch(
  "/auth/me/profile",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = profileUpdateBody.parse(req.body);
    const userId = req.auth!.userId;

    await pool.query(
      `UPDATE profiles SET full_name = $1, updated_at = now() WHERE id = $2`,
      [body.full_name.trim(), userId],
    );

    // Return updated profile
    const profile = await loadProfileById(userId);
    res.json({ profile });
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
        head_name: z.string().nullable().optional(),
      })
      .parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO departments (name, head_name) VALUES ($1, $2) RETURNING *`,
      [body.name.trim(), body.head_name ?? null],
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
        head_name: z.string().nullable().optional(),
      })
      .parse(req.body);
    const parts: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (body.name !== undefined) {
      parts.push(`name = $${n++}`);
      vals.push(body.name);
    }
    if (body.head_name !== undefined) {
      parts.push(`head_name = $${n++}`);
      vals.push(body.head_name);
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
    if (body.head_name !== undefined)
      changes.push(`head_name: "${body.head_name}"`);

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
    res.json(rows);
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
        steps: z.array(z.any()),
      })
      .parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO approval_chains (name, approval_type_id, steps, created_by) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
      [
        body.name.trim(),
        body.approval_type_id,
        JSON.stringify(body.steps),
        req.auth!.userId,
      ],
    );

    // Log audit event
    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "CREATE",
      "Approval Chain",
      `Created approval chain: ${body.name}`,
    );

    res.status(201).json(rows[0]);
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
        steps: z.array(z.any()).optional(),
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
      vals.push(JSON.stringify(body.steps));
    }
    if (parts.length === 0) throw new HttpError(400, "No fields to update");
    parts.push(`updated_at = now()`);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE approval_chains SET ${parts.join(", ")} WHERE id = $${n} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new HttpError(404, "Not found");

    // Log audit event
    const changes: string[] = [];
    if (body.name !== undefined) changes.push(`name: "${body.name}"`);
    if (body.approval_type_id !== undefined)
      changes.push(`approval_type_id updated`);
    if (body.steps !== undefined) changes.push(`steps updated`);

    await logAudit(
      req.auth!.userId,
      req.profile!.full_name,
      "UPDATE",
      "Approval Chain",
      `Updated approval chain ${rows[0].name}: ${changes.join(", ")}`,
    );

    res.json(rows[0]);
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
    res.json(rows);
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
  role_id: z.string().uuid().nullable().optional(),
  is_admin: z.boolean().optional(),
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
        `INSERT INTO profiles (id, email, full_name, department_id, role_id, is_admin)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          body.email.toLowerCase(),
          body.full_name.trim(),
          body.department_id ?? null,
          body.role_id ?? null,
          body.is_admin ?? false,
        ],
      );
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

const updateUserBody = z.object({
  full_name: z.string().min(1).optional(),
  department_id: z.string().uuid().nullable().optional(),
  role_id: z.string().uuid().nullable().optional(),
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

    // Prevent non-admin users from changing role and permissions for users with admin console access
    if (
      !isAdmin &&
      (body.role_id !== undefined || body.is_admin !== undefined)
    ) {
      // Get the target user's current permissions
      const { rows: targetUserRows } = await pool.query<{
        permissions: string[];
      }>(
        `SELECT r.permissions FROM profiles p LEFT JOIN roles r ON p.role_id = r.id WHERE p.id = $1`,
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
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (body.full_name !== undefined) {
      updates.push(`full_name = $${paramIdx}`);
      values.push(body.full_name.trim());
      paramIdx++;
    }
    if (body.department_id !== undefined) {
      updates.push(`department_id = $${paramIdx}`);
      values.push(body.department_id);
      paramIdx++;
    }
    if (body.role_id !== undefined) {
      updates.push(`role_id = $${paramIdx}`);
      values.push(body.role_id);
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

    if (updates.length === 0) {
      throw new HttpError(400, "No fields to update");
    }

    updates.push(`updated_at = now()`);

    const r = await pool.query(
      `UPDATE profiles SET ${updates.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
      [...values, req.params.userId],
    );

    if (r.rowCount === 0) throw new HttpError(404, "User not found");

    // Log audit event
    const targetUser = r.rows[0];
    const changes: string[] = [];
    if (body.full_name !== undefined)
      changes.push(`full_name: "${body.full_name}"`);
    if (body.department_id !== undefined)
      changes.push(`department_id: "${body.department_id}"`);
    if (body.role_id !== undefined) changes.push(`role_id: "${body.role_id}"`);
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

    res.json({ profile: r.rows[0] });
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

// Approval requests
apiRouter.get(
  "/approval-requests",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const admin = req.profile!.is_admin;
    const uid = req.auth!.userId;
    const roleId = req.profile!.role_id;
    const userPermissions = req.profile!.permissions || [];

    const canApprove =
      userPermissions.includes("approve_reject") ||
      userPermissions.includes("all");

    const hasListAccess =
      admin ||
      userPermissions.includes("view_own_requests") ||
      userPermissions.includes("view_department_requests") ||
      userPermissions.includes("view_all_requests") ||
      userPermissions.includes("all") ||
      userPermissions.includes("initiate_request") ||
      canApprove;

    if (!hasListAccess) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to view approval requests",
      );
    }

    let scopeClause = "";
    const queryParams: any[] = [uid, roleId];

    if (admin || userPermissions.includes("view_all_requests")) {
      scopeClause = "TRUE";
    } else if (userPermissions.includes("all")) {
      scopeClause = "TRUE";
    } else if (userPermissions.includes("view_department_requests")) {
      scopeClause =
        "(ar.initiator_id = $1 OR d.id = (SELECT department_id FROM profiles WHERE id = $1))";
    } else if (
      userPermissions.includes("view_own_requests") ||
      userPermissions.includes("initiate_request")
    ) {
      scopeClause = "ar.initiator_id = $1";
    } else {
      // approve_reject only: no broad list scope until pending/acted clauses apply
      scopeClause = "FALSE";
    }

    const pendingForMyRoleClause =
      canApprove && roleId
        ? `EXISTS (
          SELECT 1 FROM approval_actions aa_pend
          JOIN roles r_pend ON r_pend.name = aa_pend.role_name
          WHERE aa_pend.request_id = ar.id
          AND r_pend.id = $2::uuid
          AND aa_pend.status IN ('pending', 'waiting')
        )`
        : "FALSE";

    const whereCombined = `(
      ${scopeClause}
      OR EXISTS (
        SELECT 1 FROM approval_actions aa_hist
        WHERE aa_hist.request_id = ar.id
        AND aa_hist.acted_by = $1
      )
      OR ${pendingForMyRoleClause}
    )`;

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (ar.id) ar.*,
        json_build_object('name', at.name) AS approval_types,
        json_build_object('name', d.name) AS departments,
        (ar.initiator_id = $1) AS is_initiator,
        EXISTS (
          SELECT 1 FROM approval_actions aa
          JOIN roles r ON r.name = aa.role_name
          WHERE aa.request_id = ar.id
          AND ($2::uuid IS NULL OR r.id = $2::uuid)
          AND aa.status IN ('pending', 'waiting')
        ) AS needs_approval,
        aa.role_name AS current_step_role
      FROM approval_requests ar
      LEFT JOIN approval_types at ON at.id = ar.approval_type_id
      LEFT JOIN departments d ON d.id = ar.department_id
      LEFT JOIN approval_actions aa ON aa.request_id = ar.id AND aa.status IN ('pending', 'waiting')
      LEFT JOIN roles r ON r.name = aa.role_name
      WHERE ${whereCombined}
      ORDER BY ar.id, ar.created_at DESC`,
      queryParams,
    );
    res.json(rows);
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

    const hasDetailAccess =
      admin ||
      userPermissions.includes("view_own_requests") ||
      userPermissions.includes("view_department_requests") ||
      userPermissions.includes("view_all_requests") ||
      userPermissions.includes("all") ||
      userPermissions.includes("initiate_request") ||
      canApprove;

    if (!hasDetailAccess) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to view approval requests",
      );
    }

    let scopeClause = "";
    const queryParams: any[] = [req.params.id, uid, canApprove];

    if (admin || userPermissions.includes("view_all_requests")) {
      scopeClause = "ar.id = $1";
    } else if (userPermissions.includes("all")) {
      scopeClause = "ar.id = $1";
    } else if (userPermissions.includes("view_department_requests")) {
      scopeClause =
        "ar.id = $1 AND (ar.initiator_id = $2 OR d.id = (SELECT department_id FROM profiles WHERE id = $2))";
    } else if (
      userPermissions.includes("view_own_requests") ||
      userPermissions.includes("initiate_request")
    ) {
      scopeClause = "ar.id = $1 AND ar.initiator_id = $2";
    } else {
      scopeClause = "ar.id = $1 AND FALSE";
    }

    // Allow users with approve_reject permission to see all requests with pending actions
    const { rows } = await pool.query(
      `SELECT ar.*,
        json_build_object('name', at.name, 'description', at.description, 'fields', at.fields, 'page_layout', at.page_layout) AS approval_types,
        json_build_object('name', d.name) AS departments,
        json_build_object('full_name', ip.full_name) AS initiator
      FROM approval_requests ar
      LEFT JOIN approval_types at ON at.id = ar.approval_type_id
      LEFT JOIN departments d ON d.id = ar.department_id
      LEFT JOIN profiles ip ON ip.id = ar.initiator_id
      WHERE (${scopeClause}
        OR EXISTS (
          SELECT 1 FROM approval_actions aa
          WHERE aa.request_id = ar.id
          AND aa.status IN ('pending', 'waiting')
          AND (aa.role_name = (SELECT r.name FROM profiles p
            INNER JOIN roles r ON r.id = p.role_id
            WHERE p.id = $2) OR $3)
        )
        OR EXISTS (
          SELECT 1 FROM approval_actions aa
          WHERE aa.request_id = ar.id
          AND aa.acted_by = $2
        ))`,
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
    if (actorIds.length > 0) {
      const { rows: actors } = await pool.query<{
        id: string;
        full_name: string;
      }>(`SELECT id, full_name FROM profiles WHERE id = ANY($1::uuid[])`, [
        actorIds,
      ]);
      for (const a of actors) actorNames[a.id] = a.full_name;
    }
    res.json({ request: rows[0], actions, actorNames });
  }),
);

// Alternate lookup by request_number
apiRouter.get(
  "/approval-requests/by-number/:num",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const admin = req.profile!.is_admin;
    const uid = req.auth!.userId;
    const roleId = req.profile!.role_id;
    const { rows } = await pool.query(
      `SELECT ar.id FROM approval_requests ar
      WHERE ar.request_number = $1 AND ($2::boolean 
        OR ar.initiator_id = $3
        OR EXISTS (
          SELECT 1 FROM approval_actions aa
          JOIN roles r ON r.name = aa.role_name
          WHERE aa.request_id = ar.id
          AND r.id = $4
          AND aa.status IN ('pending', 'waiting')
        )
        OR EXISTS (
          SELECT 1 FROM approval_actions aa
          WHERE aa.request_id = ar.id
          AND aa.acted_by = $3
        )
      )`,
      [req.params.num, admin, uid, roleId],
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

    const { rows: typeRows } = await pool.query(
      `SELECT department_id FROM approval_types WHERE id = $1`,
      [body.approval_type_id],
    );
    if (typeRows.length === 0) {
      throw new HttpError(404, "Approval type not found");
    }

    const typeDeptId = typeRows[0].department_id as string | null;
    const selectedDeptId =
      body.department_id ?? req.profile?.department_id ?? null;

    if (typeDeptId && selectedDeptId && typeDeptId !== selectedDeptId) {
      throw new HttpError(
        400,
        "Department mismatch: approval type is restricted to its own department",
      );
    }

    const requestDeptId = selectedDeptId ?? typeDeptId ?? null;

    const { rows } = await pool.query(
      `INSERT INTO approval_requests (
        approval_type_id, approval_chain_id, initiator_id, department_id,
        form_data, current_step, total_steps, status
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
      RETURNING *`,
      [
        body.approval_type_id,
        body.approval_chain_id ?? null,
        uid,
        requestDeptId,
        JSON.stringify(body.form_data),
        body.current_step,
        body.total_steps,
        body.status,
      ],
    );

    // Log audit event
    await logAudit(
      uid,
      req.profile!.full_name,
      "CREATE",
      "Approval Request",
      `Created approval request: ${rows[0].request_number}`,
    );

    res.status(201).json(rows[0]);
  }),
);

// Approve an approval request
const actionBody = z.object({
  comment: z.string().optional(),
});

apiRouter.post(
  "/approval-requests/:id/approve",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = actionBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const userRoleId = req.profile!.role_id;
    const userPermissions = req.profile!.permissions || [];
    const isAdmin = req.profile!.is_admin;

    // Check if user has permission to approve/reject requests
    const canApproveReject =
      userPermissions.includes("approve_reject") ||
      userPermissions.includes("all");

    if (!canApproveReject && !isAdmin) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to approve requests",
      );
    }

    // Get the request
    const { rows: requests } = await pool.query(
      `SELECT ar.* FROM approval_requests ar WHERE ar.id = $1`,
      [requestId],
    );
    if (requests.length === 0) throw new HttpError(404, "Request not found");
    const request = requests[0];

    // Prevent initiator from approving their own request
    if (request.initiator_id === userId) {
      throw new HttpError(403, "You cannot approve your own request");
    }

    // Get pending actions that match the user's role
    let currentActionQuery = `
      SELECT * FROM approval_actions 
      WHERE request_id = $1 AND status IN ('pending', 'waiting') 
      ORDER BY step_order ASC, created_at DESC`;
    let queryParams: any[] = [requestId];
    let userRoleName: string | undefined;

    if (!isAdmin) {
      // For non-admins, only allow approving steps that match their role
      const { rows: roleRows } = await pool.query<{ name: string }>(
        `SELECT name FROM roles WHERE id = $1`,
        [userRoleId],
      );
      if (roleRows.length > 0) {
        userRoleName = roleRows[0].name;
        currentActionQuery = `
          SELECT * FROM approval_actions 
          WHERE request_id = $1 AND status IN ('pending', 'waiting') AND role_name = $2
          ORDER BY step_order ASC, created_at DESC LIMIT 1`;
        queryParams = [requestId, userRoleName];
      } else {
        throw new HttpError(403, "No role assigned to user");
      }
    }

    const { rows: pendingActions } = await pool.query(
      currentActionQuery,
      queryParams,
    );
    if (pendingActions.length === 0)
      throw new HttpError(400, "No pending approval step found for your role");
    const currentAction = pendingActions[0];

    // For parallel approval, we don't skip other pending actions

    // Update the current action to approved
    await pool.query(
      `UPDATE approval_actions SET status = 'approved', acted_by = $1, acted_at = now(), comment = $2 WHERE id = $3`,
      [userId, body.comment || null, currentAction.id],
    );

    // Get all actions for this request
    const { rows: allActions } = await pool.query(
      `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [requestId],
    );

    // Parallel approval: check if all pending/waiting actions are now approved
    const remainingPending = allActions.filter((a: any) =>
      ["pending", "waiting"].includes(a.status),
    );
    let newStatus = request.status;
    let newCurrentStep = request.current_step;
    
    if (remainingPending.length === 0) {
      // All steps approved
      newStatus = "approved";
    } else {
      // Still pending approvals - check if we need to advance to next step
      // Find the next step with pending actions
      const nextPendingStep = Math.min(...remainingPending.map((a: any) => a.step_order));
      if (nextPendingStep > request.current_step) {
        newCurrentStep = nextPendingStep;
      }
      newStatus = "in_progress";
    }

    // Update the request status and current_step
    await pool.query(
      `UPDATE approval_requests SET status = $1, current_step = $2, updated_at = now() WHERE id = $3`,
      [newStatus, newCurrentStep, requestId],
    );

    // Return updated request
    const { rows: updatedRequests } = await pool.query(
      `SELECT * FROM approval_requests WHERE id = $1`,
      [requestId],
    );
    const { rows: updatedActions } = await pool.query(
      `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [requestId],
    );

    // Log audit event
    await logAudit(
      userId,
      req.profile!.full_name,
      "APPROVE",
      "Approval Request",
      `Approved request: ${updatedRequests[0].request_number}`,
    );

    res.json({ request: updatedRequests[0], actions: updatedActions });
  }),
);

// Reject an approval request
apiRouter.post(
  "/approval-requests/:id/reject",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = actionBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const userRoleId = req.profile!.role_id;
    const userPermissions = req.profile!.permissions || [];
    const isAdmin = req.profile!.is_admin;

    // Check if user has permission to approve/reject requests
    const canApproveReject =
      userPermissions.includes("approve_reject") ||
      userPermissions.includes("all");

    if (!canApproveReject && !isAdmin) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to reject requests",
      );
    }

    // Get the request
    const { rows: requests } = await pool.query(
      `SELECT ar.* FROM approval_requests ar WHERE ar.id = $1`,
      [requestId],
    );
    if (requests.length === 0) throw new HttpError(404, "Request not found");
    const request = requests[0];

    // Prevent initiator from rejecting their own request
    if (request.initiator_id === userId) {
      throw new HttpError(403, "You cannot reject your own request");
    }

    // Get pending actions that match the user's role
    let currentActionQuery = `
      SELECT * FROM approval_actions 
      WHERE request_id = $1 AND status IN ('pending', 'waiting') 
      ORDER BY step_order ASC, created_at DESC`;
    let queryParams: any[] = [requestId];
    let userRoleName: string | undefined;

    if (!isAdmin) {
      // For non-admins, only allow rejecting steps that match their role
      const { rows: roleRows } = await pool.query<{ name: string }>(
        `SELECT name FROM roles WHERE id = $1`,
        [userRoleId],
      );
      if (roleRows.length > 0) {
        userRoleName = roleRows[0].name;
        currentActionQuery = `
          SELECT * FROM approval_actions 
          WHERE request_id = $1 AND status IN ('pending', 'waiting') AND role_name = $2
          ORDER BY step_order ASC, created_at DESC LIMIT 1`;
        queryParams = [requestId, userRoleName];
      } else {
        throw new HttpError(403, "No role assigned to user");
      }
    }

    const { rows: pendingActions } = await pool.query(
      currentActionQuery,
      queryParams,
    );
    if (pendingActions.length === 0)
      throw new HttpError(400, "No pending approval step found for your role");
    const currentAction = pendingActions[0];

    // For parallel approval, we don't skip other pending actions

    // Update the current action to rejected
    await pool.query(
      `UPDATE approval_actions SET status = 'rejected', acted_by = $1, acted_at = now(), comment = $2 WHERE id = $3`,
      [userId, body.comment || null, currentAction.id],
    );

    // Mark remaining pending/waiting actions as rejected
    await pool.query(
      `UPDATE approval_actions SET status = 'rejected' WHERE request_id = $1 AND status IN ('pending', 'waiting')`,
      [requestId],
    );

    // Update request status to rejected
    await pool.query(
      `UPDATE approval_requests SET status = 'rejected', updated_at = now() WHERE id = $1`,
      [requestId],
    );

    // Return updated request
    const { rows: updatedRequests } = await pool.query(
      `SELECT * FROM approval_requests WHERE id = $1`,
      [requestId],
    );
    const { rows: updatedActions } = await pool.query(
      `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [requestId],
    );

    // Log audit event
    await logAudit(
      userId,
      req.profile!.full_name,
      "REJECT",
      "Approval Request",
      `Rejected request: ${updatedRequests[0].request_number}`,
    );

    res.json({ request: updatedRequests[0], actions: updatedActions });
  }),
);

// Request changes on an approval request
apiRouter.post(
  "/approval-requests/:id/request-changes",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = actionBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;
    const userRoleId = req.profile!.role_id;
    const userPermissions = req.profile!.permissions || [];
    const isAdmin = req.profile!.is_admin;

    // Check if user has permission to approve/reject requests
    const canApproveReject =
      userPermissions.includes("approve_reject") ||
      userPermissions.includes("all");

    if (!canApproveReject && !isAdmin) {
      throw new HttpError(
        403,
        "Forbidden: You don't have permission to request changes on requests",
      );
    }

    // Get the request
    const { rows: requests } = await pool.query(
      `SELECT ar.* FROM approval_requests ar WHERE ar.id = $1`,
      [requestId],
    );
    if (requests.length === 0) throw new HttpError(404, "Request not found");
    const request = requests[0];

    // Prevent initiator from requesting changes
    if (request.initiator_id === userId) {
      throw new HttpError(
        403,
        "You cannot request changes on your own request",
      );
    }

    // Get pending actions that match the user's role
    let currentActionQuery = `
      SELECT * FROM approval_actions 
      WHERE request_id = $1 AND status IN ('pending', 'waiting') 
      ORDER BY step_order ASC, created_at DESC`;
    let queryParams: any[] = [requestId];
    let userRoleName: string | undefined;

    if (!isAdmin) {
      // For non-admins, only allow requesting changes on steps that match their role
      const { rows: roleRows } = await pool.query<{ name: string }>(
        `SELECT name FROM roles WHERE id = $1`,
        [userRoleId],
      );
      if (roleRows.length > 0) {
        userRoleName = roleRows[0].name;
        currentActionQuery = `
          SELECT * FROM approval_actions 
          WHERE request_id = $1 AND status IN ('pending', 'waiting') AND role_name = $2
          ORDER BY step_order ASC, created_at DESC LIMIT 1`;
        queryParams = [requestId, userRoleName];
      } else {
        throw new HttpError(403, "No role assigned to user");
      }
    }

    const { rows: pendingActions } = await pool.query(
      currentActionQuery,
      queryParams,
    );
    if (pendingActions.length === 0)
      throw new HttpError(400, "No pending approval step found for your role");
    const currentAction = pendingActions[0];

    // For parallel approval, we don't skip other pending actions

    // Update the current action to changes_requested
    await pool.query(
      `UPDATE approval_actions SET status = 'changes_requested', acted_by = $1, acted_at = now(), comment = $2 WHERE id = $3`,
      [userId, body.comment || null, currentAction.id],
    );

    // For sequential approval: only mark actions in the same step as changes_requested
    // For parallel approval: only mark actions in the same step as changes_requested
    await pool.query(
      `UPDATE approval_actions SET status = 'changes_requested' 
       WHERE request_id = $1 AND step_order = $2 AND status IN ('pending', 'waiting')`,
      [requestId, currentAction.step_order],
    );

    // Update request status to changes_requested
    await pool.query(
      `UPDATE approval_requests SET status = 'changes_requested', updated_at = now() WHERE id = $1`,
      [requestId],
    );

    // Return updated request
    const { rows: updatedRequests } = await pool.query(
      `SELECT * FROM approval_requests WHERE id = $1`,
      [requestId],
    );
    const { rows: updatedActions } = await pool.query(
      `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [requestId],
    );

    // Log audit event
    await logAudit(
      userId,
      req.profile!.full_name,
      "REQUEST_CHANGES",
      "Approval Request",
      `Requested changes on request: ${updatedRequests[0].request_number}`,
    );

    res.json({ request: updatedRequests[0], actions: updatedActions });
  }),
);

// Update request form data (initiator only)
const updateRequestBody = z.object({
  form_data: z.record(z.any()),
});

apiRouter.patch(
  "/approval-requests/:id",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = updateRequestBody.parse(req.body);
    const requestId = req.params.id;
    const userId = req.auth!.userId;

    // Get the request
    const { rows: requests } = await pool.query(
      `SELECT ar.* FROM approval_requests ar WHERE ar.id = $1`,
      [requestId],
    );
    if (requests.length === 0) throw new HttpError(404, "Request not found");
    const request = requests[0];

    // Only initiator can update
    if (request.initiator_id !== userId) {
      throw new HttpError(
        403,
        "Only the request initiator can update the request",
      );
    }

    // If request is not changes_requested, allow only when no approvals have happened yet.
    const { rows: approvedActions } = await pool.query(
      `SELECT id FROM approval_actions WHERE request_id = $1 AND status = 'approved' LIMIT 1`,
      [requestId],
    );
    const hasApprovedAction = approvedActions.length > 0;

    if (request.status === "changes_requested") {
      // Update form_data and set status back to in_progress
      const { rows: updatedRequests } = await pool.query(
        `UPDATE approval_requests SET form_data = $1::jsonb, status = 'in_progress', updated_at = now() WHERE id = $2 RETURNING *`,
        [JSON.stringify(body.form_data), requestId],
      );

      // Most recent "changes requested" (there may be several from multiple rounds)
      const { rows: changedActionRows } = await pool.query<{
        step_order: number;
      }>(
        `SELECT step_order FROM approval_actions
         WHERE request_id = $1 AND status = 'changes_requested'
         ORDER BY COALESCE(acted_at, created_at) DESC NULLS LAST
         LIMIT 1`,
        [requestId],
      );

      if (changedActionRows.length > 0) {
        const changedStepOrder = changedActionRows[0].step_order;

        // Deactivate existing waiting / pending actions from old cycle to avoid conflicts
        await pool.query(
          `UPDATE approval_actions SET status = 'skipped' WHERE request_id = $1 AND status IN ('pending', 'waiting')`,
          [requestId],
        );

        // Get the initiator's role name
        const { rows: initiatorRoleRows } = await pool.query<{
          role_name: string;
        }>(
          `SELECT r.name as role_name
           FROM roles r
           JOIN profiles p ON p.role_id = r.id
           WHERE p.id = $1`,
          [request.initiator_id],
        );
        const initiatorRoleName =
          initiatorRoleRows.length > 0 ? initiatorRoleRows[0].role_name : null;

        // Record initiator resubmission in the timeline (before new pending rows so it stays in history)
        const initiatorName = (req.profile!.full_name || "Initiator").trim();
        await pool.query(
          `INSERT INTO approval_actions (
            request_id, step_order, role_name, action_label, status, acted_by, acted_at
          ) VALUES ($1, $2, $3, $4, 'resubmitted', $5, now())`,
          [
            requestId,
            1, // Always start from step 1
            "Initiator",
            `Resubmitted for review (${initiatorName})`,
            userId,
          ],
        );

        const { rows: chainData } = await pool.query<{
          steps: any;
        }>(
          `SELECT ac.steps
           FROM approval_chains ac
           JOIN approval_requests ar ON ar.approval_chain_id = ac.id
           WHERE ar.id = $1`,
          [requestId],
        );

        if (chainData.length === 0 || !chainData[0].steps) {
          throw new HttpError(400, "No approval chain steps found");
        }

        const chainSteps = chainData[0].steps as any[];

        // Only recreate actions from the current step onwards, not from the beginning
        for (let i = 0; i < chainSteps.length; i++) {
          const step = chainSteps[i];
          const stepRoleName = step.roleName || step.role_name || "";
          const stepOrder = i + 1;

          // Skip steps that were already completed (before current step)
          if (stepOrder < changedStepOrder) {
            continue;
          }

          // Skip if this step's role matches the initiator's role
          if (stepRoleName === initiatorRoleName) {
            await pool.query(
              `INSERT INTO approval_actions (request_id, step_order, role_name, action_label, status)
               VALUES ($1, $2, $3, $4, 'skipped')`,
              [requestId, stepOrder, stepRoleName, step.action || "Review"],
            );
            continue;
          }

          // For the current step and future steps, create pending actions
          await pool.query(
            `INSERT INTO approval_actions (request_id, step_order, role_name, action_label, status)
             VALUES ($1, $2, $3, $4, 'pending')`,
            [requestId, stepOrder, stepRoleName, step.action || "Review"],
          );
        }

        // Update the request's current_step to point back to the step where changes were requested
        await pool.query(
          `UPDATE approval_requests SET current_step = $1, updated_at = now() WHERE id = $2`,
          [changedStepOrder, requestId],
        );
      }

      const { rows: updatedActions } = await pool.query(
        `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
        [requestId],
      );

      // Log audit event
      await logAudit(
        userId,
        req.profile!.full_name,
        "UPDATE",
        "Approval Request",
        `Updated request after changes requested: ${updatedRequests[0].request_number}`,
      );

      res.json({ request: updatedRequests[0], actions: updatedActions });
      return;
    }

    if (hasApprovedAction) {
      throw new HttpError(
        400,
        "Cannot update request after approval has been provided",
      );
    }

    if (request.status !== "pending" && request.status !== "in_progress") {
      throw new HttpError(
        400,
        "Only requests in pending/in_progress/changes_requested can be updated",
      );
    }

    // Update form_data; keep or set in_progress status for chain continuation
    const targetStatus =
      request.status === "pending" ? "in_progress" : request.status;
    const { rows: updatedRequests } = await pool.query(
      `UPDATE approval_requests SET form_data = $1::jsonb, status = $2, updated_at = now() WHERE id = $3 RETURNING *`,
      [JSON.stringify(body.form_data), targetStatus, requestId],
    );

    const { rows: updatedActions } = await pool.query(
      `SELECT * FROM approval_actions WHERE request_id = $1 ORDER BY step_order ASC, created_at ASC`,
      [requestId],
    );

    // Log audit event
    await logAudit(
      userId,
      req.profile!.full_name,
      "UPDATE",
      "Approval Request",
      `Updated request: ${updatedRequests[0].request_number}`,
    );

    res.json({ request: updatedRequests[0], actions: updatedActions });
    return;
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
    `SELECT p.id, p.full_name, p.email, p.department_id, p.role_id, p.is_admin, p.is_active, p.created_at, p.updated_at, p.failed_login_attempts, p.is_locked, p.locked_at, p.last_failed_login_at, r.permissions, r.name as role_name, d.name as department_name
     FROM profiles p
     LEFT JOIN roles r ON p.role_id = r.id
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
