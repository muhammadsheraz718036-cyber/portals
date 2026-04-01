#!/usr/bin/env node

/**
 * Applies all SQL migrations in order.
 * Run after schema or when pulling updates: npm run db:migrate
 */

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

const client = new pg.Client({ connectionString: url });

// List of all migration files in order
const migrations = [
  { name: "page_layout", file: "add-page-layout.sql" },
  { name: "password_management", file: "add-password-management.sql" },
  { name: "salutations", file: "add-salutations.sql" },
  { name: "file_attachments", file: "add-file-attachments.sql" },
  {
    name: "action_resubmitted_status",
    file: "add-action-resubmitted-status.sql",
  },
  { name: "company_phone_settings", file: "add-company-phone-settings.sql" },
  {
    name: "company_contact_department",
    file: "add-company-contact-department.sql",
  },
];

async function run() {
  try {
    await client.connect();
    console.log("🚀 Running all migrations...\n");

    // Create migration log table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_log (
          id SERIAL PRIMARY KEY,
          migration_name VARCHAR(255) NOT NULL,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(migration_name)
      );
    `);

    for (const migration of migrations) {
      console.log(`📋 Running migration: ${migration.name}...`);

      // Check if migration already ran
      const result = await client.query(
        "SELECT migration_name FROM migration_log WHERE migration_name = $1",
        [migration.name],
      );

      if (result.rows.length > 0) {
        console.log(
          `⏭️  Migration ${migration.name} already executed, skipping...\n`,
        );
        continue;
      }

      // Read and execute the migration
      const migrationSQL = readFileSync(
        join(__dirname, `../sql/${migration.file}`),
        "utf8",
      );
      await client.query(migrationSQL);

      // Record that migration was executed
      await client.query(
        "INSERT INTO migration_log (migration_name) VALUES ($1)",
        [migration.name],
      );

      console.log(`✅ Migration ${migration.name} completed successfully!\n`);
    }

    console.log("🎉 All migrations completed successfully!");
    console.log("📊 Migration summary:");

    const summary = await client.query(
      "SELECT migration_name, executed_at FROM migration_log ORDER BY executed_at",
    );

    summary.rows.forEach((row) => {
      console.log(
        `   ✓ ${row.migration_name} (${new Date(row.executed_at).toLocaleDateString()})`,
      );
    });
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
