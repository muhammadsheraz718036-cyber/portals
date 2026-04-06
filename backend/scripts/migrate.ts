#!/usr/bin/env node

/**
 * LEGACY MIGRATION SCRIPT
 * 
 * ⚠️  DEPRECATED: Individual migration files have been consolidated
 * 
 * For new databases, use: npm run db:schema
 * 
 * This script is kept for backward compatibility with existing databases
 * that were set up before the consolidation.
 */

import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
config();

console.log("🔄 LEGACY MIGRATION SCRIPT");
console.log("");
console.log("⚠️  Individual migration files have been consolidated into complete-schema.sql");
console.log("");
console.log("📋 For NEW databases, please use:");
console.log("   npm run db:schema");
console.log("");
console.log("� For EXISTING databases with legacy migrations:");
console.log("   The individual migration files have been removed but your existing");
console.log("   database continues to work normally. No action needed.");
console.log("");
console.log("📖 See sql/README.md for more information.");
console.log("");
console.log("🎯 Recommendation: Use complete-schema.sql for all new setups.");

process.exit(0);
