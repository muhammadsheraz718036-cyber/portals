import type { NextFunction, Request, Response } from "express";
import { verifyToken, type JwtPayload } from "../auth/jwt.js";
import { HttpError } from "../httpError.js";
import { pool } from "../db.js";
import { asyncMiddleware } from "../asyncMiddleware.js";

export interface AuthedRequest extends Request {
  auth?: JwtPayload & { userId: string };
  profile?: {
    id: string;
    is_admin: boolean;
    full_name: string;
    email: string;
    department_id: string | null;
    role_id: string | null;
    permissions: string[];
  };
}

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

async function loadProfile(userId: string) {
  const { rows } = await pool.query<{
    id: string;
    is_admin: boolean;
    full_name: string;
    email: string;
    department_id: string | null;
    role_id: string | null;
    permissions: string[];
  }>(
    `SELECT p.id, p.is_admin, p.full_name, p.email, p.department_id, p.role_id, COALESCE(r.permissions, '{}') as permissions
     FROM profiles p
     LEFT JOIN roles r ON p.role_id = r.id
     WHERE p.id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

async function requireAuthImpl(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
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
  } catch {
    next(new HttpError(401, "Invalid session"));
  }
}

async function requireAdminImpl(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
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
  } catch {
    next(new HttpError(401, "Invalid session"));
  }
}

export const requireAuth = asyncMiddleware<AuthedRequest>(requireAuthImpl);
export const requireAdmin = asyncMiddleware<AuthedRequest>(requireAdminImpl);
