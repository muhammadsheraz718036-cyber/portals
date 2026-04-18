import "./env.js";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ZodError } from "zod";
import { verifyDatabaseReady } from "./verifyDb.js";
import { apiRouter } from "./routes/api.js";
import { HttpError } from "./httpError.js";
function isPgError(err) {
    return (typeof err === "object" &&
        err !== null &&
        "code" in err &&
        typeof err.code === "string");
}
async function main() {
    await verifyDatabaseReady();
    const app = express();
    const port = Number(process.env.PORT) || 4000;
    // CORS configuration - allow localhost and LAN IPs in development
    const corsOrigin = process.env.CORS_ORIGIN;
    const allowedOrigins = [
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
    ];
    if (corsOrigin) {
        allowedOrigins.push(...corsOrigin.split(',').map(origin => origin.trim()).filter(origin => origin.length > 0));
    }
    if (process.env.NODE_ENV !== "production") {
        allowedOrigins.push(
            new RegExp(`^http://192\\.168\\.\\d+\\.\\d+:${port}$`),
            new RegExp(`^http://10\\.\\d+\\.\\d+\\.\\d+:${port}$`),
            new RegExp(`^http://172\\.(1[6-9]|2[0-9]|3[0-1])\\.\\d+\\.\\d+:${port}$`),
        );
    }
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin)
                return callback(null, true);
            const isAllowed = allowedOrigins.some(allowed => {
                if (typeof allowed === 'string') {
                    return allowed === origin;
                }
                return allowed.test(origin);
            });
            if (isAllowed) {
                callback(null, true);
            }
            else {
                callback(new Error(`CORS policy violation: ${origin} not allowed`));
            }
        },
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        maxAge: 86400, // 24 hours
    }));
    // Request size limit
    app.use(express.json({ limit: "2mb" }));
    // Security: Prevent parameter pollution
    app.use(express.urlencoded({ extended: true, limit: "2mb" }));
    // Security: Set X-Content-Type-Options to prevent MIME sniffing
    app.use((req, res, next) => {
        res.set("X-Content-Type-Options", "nosniff");
        res.set("X-Frame-Options", "DENY");
        res.set("X-XSS-Protection", "1; mode=block");
        res.set("Referrer-Policy", "strict-origin-when-cross-origin");
        next();
    });
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    // Serve static files from frontend dist directory
    const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");
    if (!fs.existsSync(frontendDistPath)) {
        throw new Error(`Frontend build output not found at ${frontendDistPath}. Run npm run build in frontend first.`);
    }
    app.use(express.static(frontendDistPath));
    // Handle SPA routing - serve index.html for all non-API routes
    app.get("/*", (req, res, next) => {
        if (req.path.startsWith("/api")) {
            return next();
        }
        res.sendFile(path.join(frontendDistPath, "index.html"));
    });
    app.get("/health", (_req, res) => {
        res.json({ ok: true });
    });
    app.use("/api", apiRouter);
    app.use((err, _req, res, _next) => {
        if (err instanceof HttpError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        if (err instanceof ZodError) {
            res
                .status(400)
                .json({ error: err.flatten().fieldErrors, message: err.message });
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
                res
                    .status(400)
                    .json({
                    error: "Invalid reference: related row does not exist (foreign key).",
                });
                return;
            }
            if (err.code === "23505") {
                res
                    .status(400)
                    .json({ error: "Duplicate value violates a unique constraint." });
                return;
            }
            console.error("Database error:", err);
            // Don't leak database errors in production
            const msg = process.env.NODE_ENV === "development"
                ? err.message || "Database error"
                : "An unexpected error occurred";
            res.status(500).json({ error: msg });
            return;
        }
        console.error("Unhandled error:", err);
        // Don't leak error details in production
        res.status(500).json({
            error: process.env.NODE_ENV === "development"
                ? String(err)
                : "Internal server error",
        });
    });
    app.listen(port, "0.0.0.0", () => {
        console.log(`approval-central-api listening on http://0.0.0.0:${port}`);
        console.log(`Accessible at: http://localhost:${port} (local) and http://<your-ip>:${port} (LAN)`);
    });
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
