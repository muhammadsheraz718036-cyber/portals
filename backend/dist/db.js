import pg from "pg";
import { env } from "./env.js";
const { Pool } = pg;
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: env.PG_CONNECTION_TIMEOUT_MS,
    max: env.DB_POOL_MAX,
    ssl: env.PG_SSL
        ? {
            rejectUnauthorized: env.PG_SSL_REJECT_UNAUTHORIZED,
        }
        : undefined,
});
