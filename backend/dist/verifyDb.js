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
}
