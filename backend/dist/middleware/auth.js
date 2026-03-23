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
    const { rows } = await pool.query(`SELECT id, is_admin, full_name, email, role_id FROM profiles WHERE id = $1`, [userId]);
    return rows[0] ?? null;
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
