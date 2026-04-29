import "./env.js";
import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ZodError } from "zod";
import { pool } from "./db.js";
import { env, resolveFrontendDistPath } from "./env.js";
import { HttpError } from "./httpError.js";
import { apiRouter } from "./routes/api.js";
import { verifyDatabaseReady } from "./verifyDb.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function isPgError(err) {
    return (typeof err === "object" &&
        err !== null &&
        "code" in err &&
        typeof err.code === "string");
}
async function main() {
    await verifyDatabaseReady();
    const app = express();
    const port = env.PORT;
    const host = env.HOST;
    app.disable("x-powered-by");
    app.set("trust proxy", env.TRUST_PROXY);
    const allowedOrigins = [
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
        ...env.CORS_ORIGINS,
    ];
    if (env.NODE_ENV !== "production") {
        allowedOrigins.push(new RegExp(`^http://192\\.168\\.\\d+\\.\\d+:${port}$`), new RegExp(`^http://10\\.\\d+\\.\\d+\\.\\d+:${port}$`), new RegExp(`^http://172\\.(1[6-9]|2[0-9]|3[0-1])\\.\\d+\\.\\d+:${port}$`));
    }
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin) {
                callback(null, true);
                return;
            }
            const isAllowed = allowedOrigins.some((allowed) => typeof allowed === "string" ? allowed === origin : allowed.test(origin));
            if (isAllowed) {
                callback(null, true);
                return;
            }
            callback(new Error(`CORS policy violation: ${origin} not allowed`));
        },
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        maxAge: 86400,
    }));
    app.use(express.json({ limit: "2mb" }));
    app.use(express.urlencoded({ extended: true, limit: "2mb" }));
    app.use((_req, res, next) => {
        res.set("X-Content-Type-Options", "nosniff");
        res.set("X-Frame-Options", "DENY");
        res.set("Referrer-Policy", "strict-origin-when-cross-origin");
        res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        next();
    });
    app.get("/health", (_req, res) => {
        res.json({
            ok: true,
            service: "approval-central-api",
            environment: env.NODE_ENV,
            publicUrl: env.APP_BASE_URL,
            uptimeSeconds: Math.round(process.uptime()),
        });
    });
    app.get("/health/ready", async (_req, res, next) => {
        try {
            await pool.query("SELECT 1");
            res.json({ ok: true });
        }
        catch (error) {
            next(error);
        }
    });
    app.use("/api", apiRouter);
    const frontendDistPath = resolveFrontendDistPath();
    if (!frontendDistPath || !fs.existsSync(frontendDistPath)) {
        throw new Error("Frontend build output not found. Run backend `npm run build` before starting production.");
    }
    app.use(express.static(frontendDistPath, {
        index: false,
        maxAge: env.NODE_ENV === "production" ? "1d" : 0,
        etag: true,
    }));
    app.get("/*", (req, res, next) => {
        if (req.path.startsWith("/api")) {
            next();
            return;
        }
        res.sendFile(path.join(frontendDistPath, "index.html"));
    });
    app.use((err, _req, res, _next) => {
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        if (err instanceof ZodError) {
            res.status(400).json({
                error: err.flatten().fieldErrors,
                message: err.message,
            });
            return;
        }
        if (isPgError(err)) {
            if (err.code === "42P01") {
                res.status(503).json({
                    error: "Database schema is incomplete. From the backend folder run: npm run db:schema",
                });
                return;
            }
            if (err.code === "23503") {
                res.status(400).json({
                    error: "Invalid reference: related row does not exist (foreign key).",
                });
                return;
            }
            if (err.code === "23505") {
                res.status(400).json({
                    error: "Duplicate value violates a unique constraint.",
                });
                return;
            }
            console.error("Database error:", err);
            res.status(500).json({
                error: env.NODE_ENV === "development"
                    ? err.message || "Database error"
                    : "An unexpected error occurred",
            });
            return;
        }
        console.error("Unhandled error:", err);
        res.status(500).json({
            error: env.NODE_ENV === "development"
                ? String(err)
                : "Internal server error",
        });
    });
    const server = app.listen(port, host, () => {
        console.log(`approval-central-api listening on http://${host}:${port}`);
        console.log(`Open app: ${env.DISPLAY_BASE_URL}`);
        if (env.DETECTED_BASE_URL && env.DETECTED_BASE_URL === env.APP_BASE_URL) {
            console.log(`Detected public URL from deployment environment: ${env.DETECTED_BASE_URL}`);
        }
        if (env.NODE_ENV === "production" && !env.APP_BASE_URL) {
            console.warn("APP_BASE_URL was not set and no deployment public URL was detected. Set APP_BASE_URL to the real public URL for email links and external access.");
        }
    });
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.requestTimeout = 120000;
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        console.log(`Received ${signal}, shutting down gracefully...`);
        server.close(async () => {
            await pool.end();
            process.exit(0);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
