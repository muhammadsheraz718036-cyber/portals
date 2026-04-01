import { Pool } from "pg";
const pool = new Pool({
  connectionString:
    "postgres://postgres:sunset123@localhost:5432/approval_center",
});
(async () => {
  try {
    const res = await pool.query(
      "SELECT column_name,data_type FROM information_schema.columns WHERE table_name='company_settings'",
    );
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
})();
