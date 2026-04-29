import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(backendRoot, "..");
for (const envPath of [
    resolve(backendRoot, ".env"),
    resolve(process.cwd(), ".env"),
]) {
    if (existsSync(envPath)) {
        config({ path: envPath, override: false });
    }
}
const envSchema = z
    .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
    HOST: z.string().trim().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
    JWT_SECRET: z.string().trim().min(1, "JWT_SECRET is required"),
    APP_BASE_URL: z.string().trim().optional(),
    PUBLIC_URL: z.string().trim().optional(),
    CORS_ORIGIN: z.string().trim().optional(),
    TRUST_PROXY: z
        .union([z.literal("true"), z.literal("false")])
        .default("false")
        .transform((value) => value === "true"),
    UPLOAD_DIR: z.string().trim().optional(),
    PG_SSL: z
        .union([z.literal("true"), z.literal("false")])
        .default("false")
        .transform((value) => value === "true"),
    PG_SSL_REJECT_UNAUTHORIZED: z
        .union([z.literal("true"), z.literal("false")])
        .default("true")
        .transform((value) => value === "true"),
    PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    DB_POOL_MAX: z.coerce.number().int().positive().default(20),
    EMAIL_NOTIFICATIONS_ENABLED: z
        .union([z.literal("true"), z.literal("false")])
        .default("true"),
    SMTP_HOST: z.string().trim().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_SECURE: z.union([z.literal("true"), z.literal("false")]).optional(),
    SMTP_USER: z.string().trim().optional(),
    SMTP_PASS: z.string().trim().optional(),
    SMTP_FROM: z.string().trim().optional(),
    EMAIL_PRIMARY_COLOR: z.string().trim().optional(),
})
    .superRefine((raw, ctx) => {
    if (raw.NODE_ENV === "production" && raw.JWT_SECRET.trim().length < 32) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["JWT_SECRET"],
            message: "JWT_SECRET must be at least 32 characters in production.",
        });
    }
    const smtpConfigured = Boolean(raw.SMTP_HOST || raw.SMTP_PORT || raw.SMTP_USER || raw.SMTP_PASS || raw.SMTP_FROM);
    if (smtpConfigured) {
        for (const field of ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM"]) {
            if (!raw[field]) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: [field],
                    message: `${field} is required when SMTP is configured.`,
                });
            }
        }
    }
});
const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsedEnv.error.issues) {
        const field = issue.path.join(".") || "env";
        console.error(`- ${field}: ${issue.message}`);
    }
    process.exit(1);
}
function normalizeBaseUrl(url) {
    const trimmed = url?.trim();
    if (!trimmed) {
        return undefined;
    }
    const withProtocol = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
    return withProtocol.replace(/\/+$/, "");
}
function detectPlatformBaseUrl(port) {
    const env = process.env;
    const directUrl = env.PUBLIC_URL ||
        env.RENDER_EXTERNAL_URL ||
        env.RAILWAY_STATIC_URL ||
        env.CYCLIC_URL ||
        env.REPLIT_DEV_DOMAIN;
    if (directUrl) {
        return normalizeBaseUrl(directUrl);
    }
    if (env.RAILWAY_PUBLIC_DOMAIN) {
        return normalizeBaseUrl(env.RAILWAY_PUBLIC_DOMAIN);
    }
    if (env.VERCEL_URL) {
        return normalizeBaseUrl(env.VERCEL_URL);
    }
    if (env.FLY_APP_NAME) {
        return normalizeBaseUrl(`${env.FLY_APP_NAME}.fly.dev`);
    }
    if (env.CODESPACE_NAME && env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
        return normalizeBaseUrl(`${env.CODESPACE_NAME}-${port}.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`);
    }
    return undefined;
}
function isLocalBaseUrl(url) {
    if (!url) {
        return false;
    }
    try {
        const parsed = new URL(url);
        return ["localhost", "127.0.0.1", "0.0.0.0"].includes(parsed.hostname);
    }
    catch {
        return false;
    }
}
const localBaseUrl = `http://localhost:${parsedEnv.data.PORT}`;
const detectedBaseUrl = detectPlatformBaseUrl(parsedEnv.data.PORT);
const configuredBaseUrl = normalizeBaseUrl(parsedEnv.data.APP_BASE_URL);
const configuredPublicUrl = normalizeBaseUrl(parsedEnv.data.PUBLIC_URL);
const appBaseUrl = configuredPublicUrl ||
    (isLocalBaseUrl(configuredBaseUrl) && detectedBaseUrl
        ? detectedBaseUrl
        : configuredBaseUrl) ||
    detectedBaseUrl;
const corsOrigins = (parsedEnv.data.CORS_ORIGIN?.trim() || appBaseUrl || localBaseUrl)
    .split(",")
    .map((origin) => normalizeBaseUrl(origin))
    .filter((origin) => Boolean(origin));
const uploadDir = parsedEnv.data.UPLOAD_DIR
    ? isAbsolute(parsedEnv.data.UPLOAD_DIR)
        ? parsedEnv.data.UPLOAD_DIR
        : resolve(backendRoot, parsedEnv.data.UPLOAD_DIR)
    : resolve(backendRoot, "storage", "uploads");
export const env = {
    ...parsedEnv.data,
    APP_BASE_URL: appBaseUrl,
    DETECTED_BASE_URL: detectedBaseUrl,
    LOCAL_BASE_URL: localBaseUrl,
    DISPLAY_BASE_URL: appBaseUrl || localBaseUrl,
    CORS_ORIGINS: corsOrigins,
    EMAIL_NOTIFICATIONS_ENABLED: parsedEnv.data.EMAIL_NOTIFICATIONS_ENABLED === "true",
    SMTP_SECURE: parsedEnv.data.SMTP_SECURE === undefined
        ? parsedEnv.data.SMTP_PORT === 465
        : parsedEnv.data.SMTP_SECURE === "true",
};
export const paths = {
    backendRoot,
    workspaceRoot,
    uploadDir,
    bundledFrontendDist: resolve(backendRoot, "dist", "public"),
    workspaceFrontendDist: resolve(workspaceRoot, "frontend", "dist"),
};
export function resolveFrontendDistPath() {
    for (const candidate of [
        paths.bundledFrontendDist,
        paths.workspaceFrontendDist,
    ]) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
