import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in backend/.env (see backend/.env.example)");
  process.exit(1);
}

const sql = readFileSync(join(__dirname, "../sql/schema.sql"), "utf8");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log("Schema applied.");
} finally {
  await client.end();
}
