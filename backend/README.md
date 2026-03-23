# approval-central-api

Express + PostgreSQL API for the Approval Central frontend.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (with `pgcrypto` for `gen_random_uuid`)

## Setup

1. In the **`backend`** folder, copy `.env.example` to **`.env`** and set variables (the API will not start without `DATABASE_URL`):

   - `DATABASE_URL` — connection string to an **empty** database (required)
   - `JWT_SECRET` — long random string (required)
   - `CORS_ORIGIN` — frontend origin (e.g. `http://localhost:8080`)

   Example:

   ```bash
   cd backend
   copy .env.example .env
   ```

   Then edit `.env` with your real Postgres URL and secrets.

2. Create the database schema:

   ```bash
   npm run db:schema
   ```

   This runs `sql/schema.sql` against `DATABASE_URL`.

3. Start the API:

   ```bash
   npm run dev
   ```

   Default port: **4000**.

## Frontend

From the repo root (`approval-central`), run the Vite app on port 8080. The Vite config proxies `/api` to `http://localhost:4000`, so keep both processes running during development.
