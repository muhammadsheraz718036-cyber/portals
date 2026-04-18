import { verifyToken } from "../auth/jwt.js";
import { HttpError } from "../httpError.js";
import { pool } from "../db.js";
import { asyncMiddleware } from "../asyncMiddleware.js";
function extractBearer(req) {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer "))
        return null;
    return h.slice(7).trim() || null;
}
async function loadProfile(userId) {
    const { rows } = await pool.query(`SELECT
       p.id,
       p.is_admin,
       p.full_name,
       p.email,
       p.department_id,
       p.role_id,
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
     WHERE p.id = $1`, [userId]);
    if (rows.length === 0) {
        return null;
    }
    const row = rows[0];
    return {
        ...row,
        department_ids: row.department_ids ?? [],
        role_ids: row.role_ids ?? [],
        permissions: row.permissions ?? [],
    };
}
async function requireAuthImpl(req, res, next) {
    const token = extractBearer(req);
    if (!token) {
        next(new HttpError(401, "Unauthorized"));
        return;
    }
    try {
        const payload = verifyToken(token);
        const userId = payload.sub;
        const profile = await loadProfile(userId);
        if (!profile) {
            next(new HttpError(401, "Invalid session"));
            return;
        }
        req.auth = { ...payload, userId };
        req.profile = profile;
        next();
    }
    catch {
        next(new HttpError(401, "Invalid session"));
    }
}
async function requireAdminImpl(req, res, next) {
    const token = extractBearer(req);
    if (!token) {
        next(new HttpError(401, "Unauthorized"));
        return;
    }
    try {
        const payload = verifyToken(token);
        const userId = payload.sub;
        const profile = await loadProfile(userId);
        if (!profile || !profile.is_admin) {
            next(new HttpError(403, "Forbidden"));
            return;
        }
        req.auth = { ...payload, userId };
        req.profile = profile;
        next();
    }
    catch {
        next(new HttpError(401, "Invalid session"));
    }
}
export const requireAuth = asyncMiddleware(requireAuthImpl);
export const requireAdmin = asyncMiddleware(requireAdminImpl);
