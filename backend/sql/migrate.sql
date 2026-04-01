-- Master migration script
-- This script runs all individual migration files in order
-- Run this single command to execute all migrations

-- Run individual migration files
\i sql/add-file-attachments.sql
\i sql/add-company-phone-settings.sql

-- Add future migration files here as they are created
-- \i sql/another-migration.sql

-- Record that migrations have been run
CREATE TABLE IF NOT EXISTS migration_log (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(migration_name)
);

-- Record this master migration
INSERT INTO migration_log (migration_name) 
VALUES ('master-migration-2024-03-31') 
ON CONFLICT (migration_name) DO NOTHING;
