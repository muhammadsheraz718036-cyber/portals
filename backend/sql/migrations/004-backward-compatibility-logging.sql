-- Migration 004: Add backward compatibility logging tables

-- Table for logging deprecation warnings
CREATE TABLE IF NOT EXISTS deprecation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component TEXT NOT NULL,                    -- 'approval_chain', 'workflow_engine', etc.
    warning_message TEXT NOT NULL,
    step_name TEXT,
    step_order INTEGER,
    request_id UUID REFERENCES approval_requests(id),
    user_id UUID REFERENCES users(id),
    additional_data JSONB DEFAULT '{}',
    logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for deprecation logs
CREATE INDEX IF NOT EXISTS idx_deprecation_logs_component ON deprecation_logs(component);
CREATE INDEX IF NOT EXISTS idx_deprecation_logs_logged_at ON deprecation_logs(logged_at);
CREATE INDEX IF NOT EXISTS idx_deprecation_logs_request_id ON deprecation_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_deprecation_logs_step ON deprecation_logs(step_name, step_order);

-- Table for logging migration activities
CREATE TABLE IF NOT EXISTS migration_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component TEXT NOT NULL,                    -- 'approval_step', 'approval_chain', etc.
    item_id UUID NOT NULL,                      -- ID of the migrated item
    old_value TEXT,                             -- Serialized old value
    new_value TEXT,                             -- Serialized new value
    migrated_by TEXT NOT NULL,                  -- 'system_migration', 'user_id', etc.
    migration_status TEXT DEFAULT 'success',    -- 'success', 'failed', 'partial'
    error_message TEXT,
    additional_data JSONB DEFAULT '{}',
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for migration logs
CREATE INDEX IF NOT EXISTS idx_migration_logs_component ON migration_logs(component);
CREATE INDEX IF NOT EXISTS idx_migration_logs_migrated_at ON migration_logs(migrated_at);
CREATE INDEX IF NOT EXISTS idx_migration_logs_status ON migration_logs(migration_status);
CREATE INDEX IF NOT EXISTS idx_migration_logs_item_id ON migration_logs(item_id);

-- Function to clean up old deprecation logs (keep last 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_deprecation_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM deprecation_logs 
    WHERE logged_at < now() - interval '90 days';
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old migration logs (keep last 1 year)
CREATE OR REPLACE FUNCTION cleanup_old_migration_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM migration_logs 
    WHERE migrated_at < now() - interval '1 year';
END;
$$ LANGUAGE plpgsql;

-- View for deprecation statistics
CREATE OR REPLACE VIEW deprecation_stats AS
SELECT 
    component,
    DATE_TRUNC('day', logged_at) as log_date,
    COUNT(*) as warning_count,
    COUNT(DISTINCT step_name || '|' || step_order) as unique_steps,
    COUNT(DISTINCT request_id) as unique_requests,
    array_agg(DISTINCT warning_message) as warning_types
FROM deprecation_logs 
WHERE logged_at >= now() - interval '30 days'
GROUP BY component, DATE_TRUNC('day', logged_at)
ORDER BY log_date DESC;

-- View for migration progress
CREATE OR REPLACE VIEW migration_progress AS
SELECT 
    component,
    migration_status,
    COUNT(*) as migration_count,
    MIN(migrated_at) as first_migration,
    MAX(migrated_at) as last_migration
FROM migration_logs 
WHERE migrated_at >= now() - interval '30 days'
GROUP BY component, migration_status
ORDER BY component, migration_status;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT ON deprecation_logs TO your_app_user;
-- GRANT SELECT, INSERT ON migration_logs TO your_app_user;
-- GRANT SELECT ON deprecation_stats TO your_app_user;
-- GRANT SELECT ON migration_progress TO your_app_user;

-- Create scheduled cleanup jobs (requires pg_cron extension)
-- Uncomment these lines if you have pg_cron installed:
-- SELECT cron.schedule('cleanup-deprecation-logs', '0 2 * * *', 'SELECT cleanup_old_deprecation_logs();');
-- SELECT cron.schedule('cleanup-migration-logs', '0 3 * * 0', 'SELECT cleanup_old_migration_logs();');

COMMENT ON TABLE deprecation_logs IS 'Logs deprecation warnings for backward compatibility monitoring';
COMMENT ON TABLE migration_logs IS 'Logs migration activities for tracking system changes';
COMMENT ON VIEW deprecation_stats IS 'Daily statistics for deprecation warnings by component';
COMMENT ON VIEW migration_progress IS 'Migration progress tracking by component and status';
