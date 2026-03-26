import "./env.js";
import express from "express";
import cors from "cors";
import { ZodError } from "zod";
import { verifyDatabaseReady } from "./verifyDb.js";
import { apiRouter } from "./routes/api.js";
import { HttpError } from "./httpError.js";
function isPgError(err) {
    return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string";
}
async function main() {
    await verifyDatabaseReady();
    const app = express();
    // CORS configuration - restrict in production
    app.use(cors({
        origin: process.env.CORS_ORIGIN || "http://localhost:5173",
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
            res.status(400).json({ error: err.flatten().fieldErrors, message: err.message });
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
                res.status(400).json({ error: "Invalid reference: related row does not exist (foreign key)." });
                return;
            }
            if (err.code === "23505") {
                res.status(400).json({ error: "Duplicate value violates a unique constraint." });
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
                : "Internal server error"
        });
    });
    const port = Number(process.env.PORT) || 4000;
    app.listen(port, () => {
        console.log(`approval-central-api listening on http://localhost:${port}`);
    });
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
