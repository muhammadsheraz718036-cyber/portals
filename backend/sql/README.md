# Database Migrations

This directory contains SQL migration files and scripts to manage database schema changes.

## Commands

### Run All Migrations (Recommended)
```bash
npm run db:migrate
```
This command runs all pending migrations in the correct order and tracks which migrations have been executed.

### Run Single Migration (Advanced)
```bash
npm run db:migrate:attachments
```
This runs only the file attachments migration. Use only for specific debugging or testing.

### Apply Base Schema
```bash
npm run db:schema
```
This applies the initial database schema. Run this first on a new database.

## Migration Files

- `add-page-layout.sql` - Adds page layout column to approval_types
- `add-password-management.sql` - Adds password management columns to profiles
- `add-salutations.sql` - Adds salutation columns to approval_types
- `add-file-attachments.sql` - Adds file attachment tables and functionality

## How It Works

The migration system tracks executed migrations in the `migration_log` table. When you run `npm run db:migrate`:

1. It checks each migration to see if it has already been executed
2. Skips migrations that have already run
3. Executes pending migrations in order
4. Records successful migrations in the log
5. Shows a summary of all executed migrations

## Adding New Migrations

1. Create a new SQL file in the `sql/` directory with a descriptive name
2. Add the migration to the `migrations` array in `scripts/migrate.ts`
3. Test the migration with `npm run db:migrate`

The migration system ensures that each migration runs only once, even if you run the command multiple times.
