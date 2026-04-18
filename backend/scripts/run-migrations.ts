import { config } from "dotenv";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in backend/.env (see backend/.env.example)");
  process.exit(1);
}

const migrationsDir = join(__dirname, "../sql/migrations");
const client = new pg.Client({ connectionString: url });

async function ensureSchemaMigrationsTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      migration_name TEXT NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getExecutedMigrations(): Promise<Set<string>> {
  const { rows } = await client.query<{ migration_name: string }>(
    `SELECT migration_name FROM schema_migrations`,
  );
  return new Set(rows.map((row) => row.migration_name));
}

async function run() {
  await client.connect();

  try {
    await ensureSchemaMigrationsTable();

    if (!existsSync(migrationsDir)) {
      console.log("ℹ️ No migrations directory found. Nothing to apply.");
      return;
    }

    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    if (files.length === 0) {
      console.log("ℹ️ No SQL migrations found. Nothing to apply.");
      return;
    }

    const executed = await getExecutedMigrations();
    let appliedCount = 0;

    for (const file of files) {
      if (executed.has(file)) {
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (migration_name) VALUES ($1)`,
          [file],
        );
        await client.query("COMMIT");
        appliedCount += 1;
        console.log(`✅ Applied migration: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    if (appliedCount === 0) {
      console.log("ℹ️ Database is already up to date.");
      return;
    }

    console.log(`✅ Applied ${appliedCount} migration(s).`);
  } finally {
    await client.end();
  }
}

await run();
