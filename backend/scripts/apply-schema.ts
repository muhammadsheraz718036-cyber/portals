import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import "../src/env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("Set DATABASE_URL in backend/.env (see backend/.env.example)");
  process.exit(1);
}

const sql = readFileSync(join(__dirname, "../sql/complete-schema.sql"), "utf8");
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

async function applyMigrations() {
  const { existsSync, readdirSync } = await import("node:fs");
  if (!existsSync(migrationsDir)) {
    return 0;
  }

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    return 0;
  }

  await ensureSchemaMigrationsTable();
  const { rows } = await client.query<{ migration_name: string }>(
    `SELECT migration_name FROM schema_migrations`,
  );
  const executed = new Set(rows.map((row) => row.migration_name));
  let appliedCount = 0;

  for (const file of files) {
    if (executed.has(file)) {
      continue;
    }

    const migrationSql = readFileSync(join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(migrationSql);
      await client.query(
        `INSERT INTO schema_migrations (migration_name) VALUES ($1)`,
        [file],
      );
      await client.query("COMMIT");
      appliedCount += 1;
      console.log(`Applied migration: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  return appliedCount;
}

await client.connect();
try {
  await client.query(sql);
  const appliedMigrations = await applyMigrations();
  console.log("Complete schema applied successfully.");
  console.log("All tables, indexes, constraints, and initial data created.");
  if (appliedMigrations > 0) {
    console.log(`Applied ${appliedMigrations} pending migration(s).`);
  }
} finally {
  await client.end();
}
