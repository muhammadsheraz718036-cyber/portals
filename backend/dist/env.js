import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
// Load backend/.env regardless of cwd (e.g. when running from repo root)
config({ path: resolve(__dirname, "../.env") });
// Optional: merge with cwd .env if present
config();
