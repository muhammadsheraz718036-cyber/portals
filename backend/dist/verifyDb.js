import { pool } from "./db.js";
/**
 * Fail fast with clear instructions if env, connection, or schema is wrong.
 */
export async function verifyDatabaseReady() {
    if (!process.env.JWT_SECRET?.trim()) {
        console.error("\n[JWT_SECRET] Missing or empty in backend/.env — copy backend/.env.example and set JWT_SECRET.\n");
        process.exit(1);
    }
    try {
        await pool.query("SELECT 1");
    }
    catch (e) {
        const err = e;
        if (err.code === "3D000") {
            console.error(`\n[PostgreSQL] ${err.message}\n` +
                "Create the database first (e.g. createdb approval_central), then fix DATABASE_URL in backend/.env.\n");
            process.exit(1);
        }
        if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
            console.error(`\n[PostgreSQL] Cannot connect — ${err.message}\n` +
                "Ensure PostgreSQL is running and DATABASE_URL in backend/.env is correct.\n");
            process.exit(1);
        }
        if (err.code === "ETIMEDOUT" || err.code === "ENETUNREACH") {
            console.error(`\n[PostgreSQL] Connection timed out — ${err.message}\n` +
                "The database host is reachable in DNS but not accepting connections from this machine/network.\n" +
                "Check your internet/firewall/VPN settings, confirm the DATABASE_URL host/port are correct, and verify your Postgres provider allows direct access from your current network.\n");
            process.exit(1);
        }
        if (err.code === "28P01" || err.code === "password authentication failed") {
            console.error(`\n[PostgreSQL] Authentication failed — check username/password in DATABASE_URL.\n`);
            process.exit(1);
        }
        throw e;
    }
    const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS ok
  `);
    if (!rows[0]?.ok) {
        console.error(`
================================================================
  Database tables are missing.

  From the backend folder run (once):

    npm run db:schema

  Prerequisites:
  - PostgreSQL is running
  - DATABASE_URL points at an existing database (create it first if needed)
================================================================
`);
        process.exit(1);
    }
    // ---------------------------------------------------------------------
    // Idempotent self-healing migrations for strict per-user approval routing.
    // Safe to run on every startup; only acts if the schema/data needs it.
    // ---------------------------------------------------------------------
    // 1. Ensure approver_user_id column + supporting indexes exist.
    await pool.query(`
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS signature_url TEXT
  `);
    await pool.query(`
    ALTER TABLE approval_actions
      ADD COLUMN IF NOT EXISTS approver_user_id UUID
  `);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_approval_actions_approver_user
      ON approval_actions(approver_user_id)
  `);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_approval_actions_request_step
      ON approval_actions(request_id, step_order)
  `);
    await pool.query(`
    ALTER TABLE approval_requests
      ADD COLUMN IF NOT EXISTS work_assignee_id UUID
  `);
    await pool.query(`
    ALTER TABLE approval_types
      ADD COLUMN IF NOT EXISTS default_work_assignee_id UUID
  `);
    await pool.query(`
    ALTER TABLE approval_type_attachments
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
  `);
    await pool.query(`
    ALTER TABLE approval_type_attachments
      ADD COLUMN IF NOT EXISTS template_original_filename TEXT
  `);
    await pool.query(`
    ALTER TABLE approval_type_attachments
      ADD COLUMN IF NOT EXISTS template_stored_filename TEXT
  `);
    await pool.query(`
    ALTER TABLE approval_type_attachments
      ADD COLUMN IF NOT EXISTS template_file_path TEXT
  `);
    await pool.query(`
    ALTER TABLE approval_type_attachments
      ADD COLUMN IF NOT EXISTS template_file_size_bytes BIGINT
  `);
    await pool.query(`
    ALTER TABLE approval_type_attachments
      ADD COLUMN IF NOT EXISTS template_mime_type TEXT
  `);
    await pool.query(`
    ALTER TABLE approval_type_attachments
      ADD COLUMN IF NOT EXISTS template_uploaded_by UUID REFERENCES users(id)
  `);
    await pool.query(`
    ALTER TABLE approval_type_attachments
      ADD COLUMN IF NOT EXISTS template_uploaded_at TIMESTAMPTZ
  `);
    await pool.query(`
    ALTER TABLE approval_chains
      ADD COLUMN IF NOT EXISTS default_work_assignee_id UUID
  `);
    await pool.query(`
    ALTER TABLE approval_requests
      ADD COLUMN IF NOT EXISTS work_assigned_by UUID
  `);
    await pool.query(`
    ALTER TABLE approval_requests
      ADD COLUMN IF NOT EXISTS work_assigned_at TIMESTAMPTZ
  `);
    await pool.query(`
    ALTER TABLE approval_requests
      ADD COLUMN IF NOT EXISTS work_completed_by UUID
  `);
    await pool.query(`
    ALTER TABLE approval_requests
      ADD COLUMN IF NOT EXISTS work_completed_at TIMESTAMPTZ
  `);
    await pool.query(`
    ALTER TABLE approval_requests
      ADD COLUMN IF NOT EXISTS work_status TEXT NOT NULL DEFAULT 'pending'
  `);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_approval_requests_work_assignee
      ON approval_requests(work_assignee_id)
  `);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
      request_id UUID REFERENCES approval_requests(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC)
  `);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
      ON notifications(user_id, read_at)
  `);
    await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM information_schema.table_constraints
         WHERE table_schema = 'public'
           AND table_name = 'approval_requests'
           AND constraint_name = 'approval_requests_work_status_check'
      ) THEN
        ALTER TABLE approval_requests
          DROP CONSTRAINT approval_requests_work_status_check;
      END IF;

      ALTER TABLE approval_requests
        ADD CONSTRAINT approval_requests_work_status_check
        CHECK (work_status IN ('pending', 'assigned', 'in_progress', 'done', 'not_done'));
    END
    $$;
  `);
    await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM information_schema.table_constraints
         WHERE table_schema = 'public'
           AND table_name = 'approval_actions'
           AND constraint_name = 'approval_actions_status_check'
      ) THEN
        ALTER TABLE approval_actions
          DROP CONSTRAINT approval_actions_status_check;
      END IF;

      ALTER TABLE approval_actions
        ADD CONSTRAINT approval_actions_status_check
        CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped', 'changes_requested', 'resubmitted', 'edited'));
    END
    $$;
  `);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS user_departments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
      UNIQUE(user_id, department_id)
    )
  `);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_departments_user_id
      ON user_departments(user_id)
  `);
    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_departments_department_id
      ON user_departments(department_id)
  `);
    // 2. Backfill approver_user_id for legacy open actions so existing in-flight
    //    requests route to a single specific user under the new isolation rules.
    //    Priority per action (only when approver_user_id IS NULL):
    //      a) Active user in the request's department with the action's role.
    //      b) Active department manager of the request's department.
    //      c) Any active user globally holding the action's role.
    //    Never overwrites an existing assignee or already-acted row.
    await pool.query(`
    WITH candidates AS (
      SELECT
        aa.id,
        COALESCE(
          (
            SELECT p.id FROM profiles p
              JOIN roles r ON r.id = p.role_id
             WHERE p.department_id = ar.department_id
               AND lower(trim(r.name)) = lower(trim(aa.role_name))
               AND p.is_active = true
               AND p.id <> ar.initiator_id
             ORDER BY p.created_at ASC
             LIMIT 1
          ),
          (
            SELECT p.id FROM department_managers dm
              JOIN profiles p ON p.id = dm.user_id
             WHERE dm.department_id = ar.department_id
               AND dm.is_active = true
               AND p.is_active = true
               AND p.id <> ar.initiator_id
             ORDER BY dm.assigned_at ASC
             LIMIT 1
          ),
          (
            SELECT p.id FROM profiles p
              JOIN roles r ON r.id = p.role_id
             WHERE lower(trim(r.name)) = lower(trim(aa.role_name))
               AND p.is_active = true
               AND p.id <> ar.initiator_id
             ORDER BY p.created_at ASC
             LIMIT 1
          )
        ) AS resolved
      FROM approval_actions aa
      JOIN approval_requests ar ON ar.id = aa.request_id
      WHERE aa.approver_user_id IS NULL
        AND aa.status IN ('pending', 'waiting')
    )
    UPDATE approval_actions aa
       SET approver_user_id = c.resolved
      FROM candidates c
     WHERE aa.id = c.id
       AND c.resolved IS NOT NULL
  `);
    await pool.query(`
    UPDATE department_managers dm
       SET is_active = false
      FROM profiles p
      LEFT JOIN roles r ON r.id = p.role_id
     WHERE dm.user_id = p.id
       AND (
         p.is_active = false
         OR p.department_id IS NULL
         OR lower(trim(COALESCE(r.name, ''))) <> lower('Department Manager')
         OR dm.department_id <> p.department_id
       )
  `);
    await pool.query(`
    INSERT INTO department_managers (department_id, user_id, is_active)
    SELECT p.department_id, p.id, true
      FROM profiles p
      JOIN roles r ON r.id = p.role_id
     WHERE p.is_active = true
       AND p.department_id IS NOT NULL
       AND lower(trim(r.name)) = lower('Department Manager')
    ON CONFLICT (department_id, user_id)
    DO UPDATE SET is_active = true
  `);
}
