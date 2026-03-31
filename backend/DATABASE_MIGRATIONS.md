# Database Migrations

## Single Command Migration

Run all pending migrations with one command:

```bash
npm run db:migrate
```

## How It Works

The migration system automatically:
1. ✅ Checks which migrations have already been executed
2. ✅ Runs only pending migrations in order
3. ✅ Skips already-executed migrations safely
4. ✅ Logs all migrations for tracking
5. ✅ Provides clear success/failure feedback

## Available Migrations

Current migrations in execution order:
- `page_layout` - Adds page layout support to approval types
- `password_management` - Adds password management fields
- `salutations` - Adds pre/post salutation fields for letters
- `file_attachments` - Adds file attachment support

## Best Practices

- **Idempotent**: All migrations can be safely re-run
- **Tracked**: Migration log prevents duplicate execution
- **Ordered**: Migrations run in dependency order
- **Safe**: Uses PostgreSQL `IF NOT EXISTS` syntax

## Initial Setup

For new database setup:
```bash
npm run db:schema  # Apply base schema
npm run db:migrate  # Run all migrations
```

## Adding New Migrations

1. Create SQL file in `sql/` directory (e.g., `add-feature.sql`)
2. Add to migration list in `scripts/migrate.ts`
3. Run `npm run db:migrate`

The migration system ensures consistent database state across all environments.
