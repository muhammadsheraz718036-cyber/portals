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
