# Approval Central

Approval Central is a full-stack approval workflow system with:

- a React + Vite frontend in `frontend/`
- an Express + PostgreSQL backend in `backend/`
- a production build where the backend serves the frontend from the same Node process

## Stack

- Node.js 20+
- npm 10+
- PostgreSQL 14+
- React 18
- Vite
- Express
- TypeScript
- PM2

## Project Structure

```text
approval-central/
|-- backend/
|   |-- src/
|   |-- sql/
|   |-- scripts/
|   |-- .env.example
|   `-- ecosystem.config.cjs
|-- frontend/
|   |-- src/
|   |-- public/
|   `-- .env.example
`-- README.md
```

## How It Runs

Development:

- frontend runs on `http://localhost:8080`
- backend runs on `http://localhost:3001`
- Vite proxies `/api` to the backend

Production:

- backend serves both the frontend and API
- the app is exposed from one Node process on `PORT`
- hosted platforms can inject `PORT`; VPS/PM2 deployments can set `PORT=8080`
- the startup log prints the URL to open

## Install

From the repo root:

```bash
cd backend
npm install

cd ../frontend
npm install
```

## Configure Environment

### Backend

Copy `backend/.env.example` to `backend/.env` and set your real values.

Example development config:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/approval_center
JWT_SECRET=replace-with-a-long-random-string
PORT=3001
NODE_ENV=development
HOST=0.0.0.0
APP_BASE_URL=http://localhost:8080
CORS_ORIGIN=http://localhost:8080
TRUST_PROXY=false
```

Example production config:

```env
DATABASE_URL=postgresql://postgres:password@db-host:5432/approval_center
JWT_SECRET=replace-with-a-strong-secret-32-characters-or-more
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
APP_BASE_URL=https://approvals.yourcompany.com
CORS_ORIGIN=https://approvals.yourcompany.com
TRUST_PROXY=true
UPLOAD_DIR=storage/uploads
PG_SSL=false
PG_SSL_REJECT_UNAUTHORIZED=true
PG_CONNECTION_TIMEOUT_MS=10000
DB_POOL_MAX=20
EMAIL_NOTIFICATIONS_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-app-password
SMTP_FROM="Approval Central <notifications@example.com>"
```

Important:

- `JWT_SECRET` must be strong in production.
- If your database password contains special characters like `@`, `:`, or `/`, URL-encode the password in `DATABASE_URL`.
- `APP_BASE_URL` should match the real browser URL used by users. The app can auto-detect common platform URL variables such as `PUBLIC_URL`, `RENDER_EXTERNAL_URL`, `RAILWAY_PUBLIC_DOMAIN`, `VERCEL_URL`, `FLY_APP_NAME`, and GitHub Codespaces forwarding variables.
- `CORS_ORIGIN` can be left empty for same-origin deployments. Set it only when another frontend origin must call this backend.
- `HOST=0.0.0.0` is recommended for deployed environments.
- `TRUST_PROXY=true` is recommended when Node is behind a reverse proxy.

### Frontend

The frontend usually does not need a local `.env` file.

Default recommended config:

```env
VITE_API_URL=
```

Notes:

- leave `VITE_API_URL` empty in development so Vite uses the proxy
- leave it empty in production when the frontend is served by the backend on the same origin

## Create Database

Create the database first:

```bash
createdb approval_center
```

Or in PostgreSQL:

```sql
CREATE DATABASE approval_center;
```

## Apply Schema

From `backend/`:

```bash
npm run db:schema
```

If you are updating an existing installation with migrations:

```bash
npm run db:migrate
```

## Run in Development

Terminal 1:

```bash
cd backend
npm run dev
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Open:

- frontend: `http://localhost:8080`
- backend health: `http://localhost:3001/health`

## Build for Production

From `backend/`:

```bash
npm run build
```

This command:

1. builds the frontend
2. compiles the backend TypeScript
3. copies the frontend build into `backend/dist/public`

## Run in Production Without PM2

From `backend/`:

```bash
npm run build
npm start
```

Open the URL printed by the startup log.

Example:

```text
Open app: https://approvals.yourcompany.com
```

If the log shows a localhost URL on a deployed server, set `APP_BASE_URL` to your real public URL and restart the app.

## Run in Production With PM2

From `backend/`:

```bash
npm run build
npm run pm2:start
npm run pm2:save
```

Useful PM2 commands:

```bash
npm run pm2:status
npm run pm2:logs
npm run pm2:restart
node scripts/pm2-cli.mjs stop approval-central
```

Notes:

- PM2 is installed locally in `backend`
- PM2 uses `backend/.pm2/` as its home directory in this project
- if you change `backend/.env`, run `npm run pm2:restart`

## Public URL Behavior

The backend serves the React app and API from the same origin. At startup it chooses the public URL in this order:

1. `APP_BASE_URL`
2. `PUBLIC_URL`
3. common platform variables such as `RENDER_EXTERNAL_URL`, `RAILWAY_PUBLIC_DOMAIN`, `VERCEL_URL`, `FLY_APP_NAME`, and GitHub Codespaces forwarding variables
4. `http://localhost:<PORT>` as a local fallback

For a VPS, private server, or custom domain, set:

```env
APP_BASE_URL=https://your-domain.example
CORS_ORIGIN=https://your-domain.example
TRUST_PROXY=true
```

For platforms that provide a public URL automatically, you can usually leave `APP_BASE_URL` empty and read the printed `Open app:` line.

## Production Topology

Recommended production setup:

- Node.js 20 LTS or newer
- PostgreSQL on the same trusted network or same server
- PM2 as the Node process manager
- optional reverse proxy in front of Node such as Nginx, IIS, Apache, or a datacenter load balancer

If you use a reverse proxy, forward the public site to the Node app.

Example target:

```text
http://127.0.0.1:8080
```

Forward these headers:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

The Node app already:

- serves the SPA
- exposes `GET /health`
- exposes `GET /health/ready`
- shuts down gracefully on `SIGINT` and `SIGTERM`

## Exact Commands Summary

### First-time local setup

```bash
cd backend
npm install
copy .env.example .env
npm run db:schema

cd ../frontend
npm install
copy .env.example .env
```

Windows PowerShell alternative:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

### Start local development

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm run dev
```

### Build production package

```bash
cd backend
npm run build
```

### Start production directly with Node

```bash
cd backend
npm start
```

### Start production with PM2

```bash
cd backend
npm run pm2:start
npm run pm2:save
```

## Frontend Scripts

From `frontend/`:

```bash
npm run dev
npm run build
npm run build:dev
npm run preview
npm run lint
npm run test
npm run test:watch
```

## Backend Scripts

From `backend/`:

```bash
npm run dev
npm run build
npm start
npm run db:schema
npm run db:migrate
npm run pm2:start
npm run pm2:save
npm run pm2:status
npm run pm2:logs
```

## Health Endpoints

- `GET /health`
- `GET /health/ready`

Examples:

```text
http://localhost:3001/health
https://approvals.yourcompany.com/health
```

## Deployment Checklist

- `backend/.env` exists and uses production values
- `JWT_SECRET` is strong and unique
- PostgreSQL is reachable from the app server
- `npm run build` completed successfully
- `npm run db:schema` or `npm run db:migrate` completed successfully
- the startup log prints the public URL you expect, or `APP_BASE_URL` is set to it
- if using a reverse proxy, it forwards traffic to the correct Node port
- TLS/HTTPS is terminated at the proxy or load balancer if needed
- `backend/storage/uploads` is included in backup strategy
- database backups are scheduled

## Troubleshooting

### App does not open on the expected URL

- make sure `PORT` in `backend/.env` matches the URL you are opening
- check the startup log for `Open app: ...`
- if a deployed server prints a localhost URL, set `APP_BASE_URL` to the real public URL
- if using PM2 after changing `.env`, run:

```bash
npm run pm2:restart
```

### Database connection fails

- confirm PostgreSQL is running
- confirm `DATABASE_URL` is correct
- confirm the database exists
- URL-encode special characters in the password

### Frontend cannot reach API in development

- backend must be running on `3001`
- frontend must be running on `8080`
- keep `VITE_API_URL` empty to use the Vite proxy

### PM2 starts but old config is still used

Restart with updated environment:

```bash
node scripts/pm2-cli.mjs restart approval-central --update-env
```
