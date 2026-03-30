#!/usr/bin/env node

/**
 * Applies incremental SQL migrations (page layout, password lockout columns, etc.).
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

async function run() {
  try {
    await client.connect();
    console.log(
      "Running migration: Add page_layout column to approval_types...",
    );

    // Read and execute the migration
    const migration = readFileSync(
      join(__dirname, "../sql/add-page-layout.sql"),
      "utf8",
    );
    await client.query(migration);

    console.log(
      "✓ page_layout column added to approval_types table (or already exists)",
    );

    console.log(
      "Running migration: Add password management columns to profiles...",
    );
    const passwordMigration = readFileSync(
      join(__dirname, "../sql/add-password-management.sql"),
      "utf8",
    );
    await client.query(passwordMigration);

    console.log("✓ Migration completed successfully!");
    console.log("✓ Password lockout columns on profiles (or already present)");

    console.log(
      "Running migration: Add salutation columns to approval_types...",
    );
    const salutationMigration = readFileSync(
      join(__dirname, "../sql/add-salutations.sql"),
      "utf8",
    );
    await client.query(salutationMigration);

    console.log("✓ Salutation columns added to approval_types table");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
