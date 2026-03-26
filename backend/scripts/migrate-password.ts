#!/usr/bin/env node

/**
 * Migration script to add password management fields to profiles table
 * Run this after pulling the latest code: npm run migrate-password
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
      "Running migration: Add password management fields to profiles...",
    );

    // Read and execute the migration
    const migration = readFileSync(
      join(__dirname, "../sql/add-password-management.sql"),
      "utf8",
    );
    await client.query(migration);

    console.log("✓ Migration completed successfully!");
    console.log(
      "✓ Added failed_login_attempts, is_locked, locked_at, last_failed_login_at fields to profiles table",
    );
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
