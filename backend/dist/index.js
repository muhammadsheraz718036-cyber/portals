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
    app.use(cors({
        origin: process.env.CORS_ORIGIN || true,
        credentials: true,
    }));
    app.use(express.json({ limit: "2mb" }));
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
            console.error(err);
            res.status(500).json({ error: err.message || "Database error" });
            return;
        }
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
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
