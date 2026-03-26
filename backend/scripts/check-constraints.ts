#!/usr/bin/env node

import pg from "pg";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

async function checkConstraints() {
  try {
    await client.connect();
    const result = await client.query(`
      SELECT constraint_name, check_clause
      FROM information_schema.check_constraints
      WHERE constraint_name IN ('approval_requests_status_check', 'approval_actions_status_check')
      ORDER BY constraint_name;
    `);
    console.log("Database constraints:");
    result.rows.forEach((row) => {
      console.log(`${row.constraint_name}: ${row.check_clause}`);
    });
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

checkConstraints();
