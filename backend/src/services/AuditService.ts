import type { NextFunction, Request, Response } from "express";
import { pool } from "../db.js";
import type { AuthedRequest } from "../middleware/auth.js";

type AuditStatus = "SUCCESS" | "FAILURE";
type AuditCategory =
  | "AUTH"
  | "SESSION"
  | "READ"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "WORKFLOW"
  | "ADMIN"
  | "SYSTEM";

export type AuditLogInput = {
  userId?: string | null;
  userName: string;
  action: string;
  target: string;
  details?: string | null;
  category?: AuditCategory;
  status?: AuditStatus;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  httpMethod?: string | null;
  routePath?: string | null;
  metadata?: Record<string, unknown> | null;
};

function truncate(value: string | null | undefined, max = 400): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function getIpAddress(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return truncate(forwarded.split(",")[0]?.trim() ?? null, 64);
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return truncate(forwarded[0], 64);
  }
  return truncate(req.ip ?? null, 64);
}

function getUserAgent(req: Request): string | null {
  const userAgent = req.headers["user-agent"];
  if (Array.isArray(userAgent)) {
    return truncate(userAgent[0] ?? null, 500);
  }
  return truncate(userAgent ?? null, 500);
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    return value.length > 250 ? `${value.slice(0, 247)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeValue);
  }
  if (typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return String(value);
}

function sanitizeObject(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!record) return {};
  const blockedKeys = new Set([
    "password",
    "new_password",
    "current_password",
    "password_hash",
    "token",
    "authorization",
    "signature_url",
  ]);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (blockedKeys.has(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = sanitizeValue(value);
  }

  return out;
}

function mapMethodToCategory(method: string): AuditCategory {
  switch (method.toUpperCase()) {
    case "GET":
      return "READ";
    case "POST":
      return "CREATE";
    case "PATCH":
    case "PUT":
      return "UPDATE";
    case "DELETE":
      return "DELETE";
    default:
      return "SYSTEM";
  }
}

function buildRequestDetails(req: Request, res: Response): string {
  const path = req.originalUrl || req.path;
  return `${req.method.toUpperCase()} ${path} completed with status ${res.statusCode}.`;
}

let ensureColumnsPromise: Promise<void> | null = null;

export async function ensureAuditLogColumns(): Promise<void> {
  if (ensureColumnsPromise) {
    return ensureColumnsPromise;
  }

  ensureColumnsPromise = (async () => {
    await pool.query(
      `ALTER TABLE audit_logs
         ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'SYSTEM',
         ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'SUCCESS',
         ADD COLUMN IF NOT EXISTS entity_type TEXT,
         ADD COLUMN IF NOT EXISTS entity_id TEXT,
         ADD COLUMN IF NOT EXISTS ip_address TEXT,
         ADD COLUMN IF NOT EXISTS user_agent TEXT,
         ADD COLUMN IF NOT EXISTS http_method TEXT,
         ADD COLUMN IF NOT EXISTS route_path TEXT,
         ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`,
    );
  })().catch((error) => {
    ensureColumnsPromise = null;
    throw error;
  });

  return ensureColumnsPromise;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await ensureAuditLogColumns();
    await pool.query(
      `INSERT INTO audit_logs (
         user_id,
         user_name,
         action,
         target,
         details,
         category,
         status,
         entity_type,
         entity_id,
         ip_address,
         user_agent,
         http_method,
         route_path,
         metadata
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb
       )`,
      [
        input.userId ?? null,
        input.userName,
        input.action,
        input.target,
        input.details ?? null,
        input.category ?? "SYSTEM",
        input.status ?? "SUCCESS",
        input.entityType ?? null,
        input.entityId ?? null,
        truncate(input.ipAddress, 64),
        truncate(input.userAgent, 500),
        input.httpMethod ?? null,
        input.routePath ?? null,
        JSON.stringify(sanitizeObject(input.metadata ?? {})),
      ],
    );
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }
}

export async function logRequestActivity(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  if (!req.auth || !req.profile) return;
  if (req.path === "/auth/me") return;

  await writeAuditLog({
    userId: req.auth.userId,
    userName: req.profile.full_name,
    action: `${req.method.toUpperCase()} ${req.path}`,
    target: "API Activity",
    details: buildRequestDetails(req, res),
    category: mapMethodToCategory(req.method),
    status: res.statusCode >= 400 ? "FAILURE" : "SUCCESS",
    entityType: "api_route",
    entityId: req.path,
    ipAddress: getIpAddress(req),
    userAgent: getUserAgent(req),
    httpMethod: req.method.toUpperCase(),
    routePath: req.originalUrl || req.path,
    metadata: {
      query: sanitizeObject(req.query as Record<string, unknown>),
      params: sanitizeObject(req.params as Record<string, unknown>),
      body:
        req.method.toUpperCase() === "GET"
          ? {}
          : sanitizeObject(req.body as Record<string, unknown>),
      statusCode: res.statusCode,
    },
  });
}

export function attachAuditTrail(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  res.on("finish", () => {
    void logRequestActivity(req, res);
  });
  next();
}

export function getAuditRequestContext(req: Request): {
  ipAddress: string | null;
  userAgent: string | null;
  routePath: string;
  httpMethod: string;
} {
  return {
    ipAddress: getIpAddress(req),
    userAgent: getUserAgent(req),
    routePath: req.originalUrl || req.path,
    httpMethod: req.method.toUpperCase(),
  };
}

