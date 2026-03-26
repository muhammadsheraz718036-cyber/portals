# approval-central-api

Express + PostgreSQL API for the Approval Central approval request management system.

## Overview

This is a RESTful API that manages approval workflows, user authentication, role-based access control, and audit logging. It's built with Express.js, TypeScript, and PostgreSQL.

## Prerequisites

- **Node.js** 20.0 or higher
- **npm** 10.0 or higher
- **PostgreSQL** 14.0 or higher (with `pgcrypto` extension for UUID generation)
- **Git** for version control

## Quick Start

### 1. Setup Environment

```bash
cd backend

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# nano .env  or  code .env
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Database

```bash
# Create an empty PostgreSQL database
createdb approval_central

# Or using psql:
# psql -c "CREATE DATABASE approval_central;"
```

### 4. Initialize Database Schema

```bash
npm run db:schema
```

This will:

- Create all required tables
- Set up indexes and constraints
- Enable required PostgreSQL extensions

### 5. Start Development Server

```bash
npm run dev
```

You should see:

```
approval-central-api listening on http://localhost:4000
```

## Configuration

### Required Environment Variables (.env)

```bash
# PostgreSQL connection string (REQUIRED)
# Format: postgresql://username:password@host:port/database
DATABASE_URL=postgresql://user:password@localhost:5432/approval_central

# JWT secret for token signing (REQUIRED)
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=abc123xyz789... (min 32 characters, random)

# Server port (optional, default 4000)
PORT=4000

# Node environment (development/production)
NODE_ENV=development

# Frontend URL for CORS (REQUIRED)
CORS_ORIGIN=http://localhost:5173
```

### .env.example

Copy `.env.example` to `.env` and update with your values:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/approval_center
JWT_SECRET=change-me-to-a-long-random-string-in-production
PORT=4000
CORS_ORIGIN=http://localhost:5173
```

## Development Scripts

```bash
# Start development server with hot reload
npm run dev

# Build TypeScript to JavaScript
npm run build

# Start production server
npm start

# Initialize database schema
npm run db:schema

# Run database migrations
npm run db:migrate
```

## Project Structure

```
src/
├── index.ts                # Express server setup
├── env.ts                  # Environment configuration
├── db.ts                   # Database connection
├── httpError.ts            # Custom error class
├── asyncHandler.ts         # Async error wrapper
├── asyncMiddleware.ts      # Express async middleware
├── verifyDb.ts             # Database verification
├── auth/
│   ├── jwt.ts             # JWT token management
│   └── password.ts        # Password hashing (bcryptjs)
├── middleware/
│   └── auth.ts            # Authentication middleware
└── routes/
    └── api.ts             # API endpoint definitions

sql/
└── schema.sql             # Database schema

scripts/
└── apply-schema.ts        # Schema setup script
```

## API Endpoints

### Authentication

- `POST /api/setup` - Initial admin setup (no auth required)
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Current user profile
- `PATCH /api/auth/me/password` - Change password
- `PATCH /api/auth/me/profile` - Update profile

### Approval Requests

- `GET /api/approval-requests` - List requests (paginated)
- `POST /api/approval-requests` - Create new request
- `GET /api/approval-requests/:id` - Get request details
- `PATCH /api/approval-requests/:id` - Update request
- `POST /api/approval-requests/:id/actions` - Approve/Reject

### Admin - Users

- `GET /api/users` - List all users
- `POST /api/users` - Create new user
- `PATCH /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Admin - Roles

- `GET /api/roles` - List roles
- `POST /api/roles` - Create role
- `PATCH /api/roles/:id` - Update role
- `DELETE /api/roles/:id` - Delete role

### Admin - Approval Types

- `GET /api/approval-types` - List approval types
- `POST /api/approval-types` - Create type
- `PATCH /api/approval-types/:id` - Update type
- `DELETE /api/approval-types/:id` - Delete type

### Admin - Approval Chains

- `GET /api/approval-chains` - List chains
- `POST /api/approval-chains` - Create chain
- `PATCH /api/approval-chains/:id` - Update chain
- `DELETE /api/approval-chains/:id` - Delete chain

### Admin - Departments

- `GET /api/departments` - List departments
- `POST /api/departments` - Create department
- `PATCH /api/departments/:id` - Update department
- `DELETE /api/departments/:id` - Delete department

### Admin - Settings

- `GET /api/settings` - Get system settings
- `PATCH /api/settings` - Update settings

### Audit

- `GET /api/audit-logs` - List audit logs (admin only)

### Health

- `GET /health` - Health check (no auth required)

## Authentication

All endpoints (except `/health` and `/api/setup`) require Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     http://localhost:4000/api/auth/me
```

Tokens expire after 7 days. Users must log in again to get a new token.

## Database Schema

### Core Tables

- **profiles** - User accounts, roles, departments
- **roles** - User roles with permissions
- **departments** - Organizational structure
- **approval_types** - Request type definitions with custom fields
- **approval_chains** - Multi-step approval workflows
- **approval_requests** - Submitted approval requests
- **approval_actions** - Approval history and decisions
- **audit_logs** - System activity tracking
- **settings** - System configuration

All tables have `created_at` and `updated_at` timestamps for auditing.

## Security

### Implemented Security Measures

- ✅ **JWT Authentication** - 7-day token expiration
- ✅ **Password Security** - bcryptjs with 10 salt rounds
- ✅ **SQL Injection Prevention** - Parameterized queries
- ✅ **CORS Configuration** - Restricted to specific origins
- ✅ **Security Headers** - X-Content-Type-Options, X-Frame-Options, etc.
- ✅ **Error Handling** - No sensitive information in error messages (prod)
- ✅ **Input Validation** - Zod schema validation
- ✅ **Audit Logging** - All significant actions logged

### Environment Variable Security

- `.env` files are in `.gitignore` (never committed)
- Use `.env.example` as template for team
- Rotate secrets regularly in production
- Store secrets in secure vault in production (AWS Secrets Manager, etc.)

## Troubleshooting

### Issue: "Cannot find module 'pg'"

```bash
npm install
```

### Issue: "Database connection failed"

1. Check PostgreSQL is running: `psql --version`
2. Verify `DATABASE_URL` in `.env`
3. Test connection: `psql <DATABASE_URL>`
4. Ensure database exists: `createdb approval_central`

### Issue: "EADDRINUSE: address already in use :::4000"

```bash
# Find and kill process on port 4000
# On Windows:
netstat -ano | findstr :4000
taskkill /PID <PID> /F

# On Mac/Linux:
lsof -i :4000
kill -9 <PID>
```

### Issue: "pgcrypto extension not found"

```bash
# Enable the extension
psql approval_central -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

### Issue: "JWT_SECRET is required"

Ensure `.env` file exists and has JWT_SECRET set:

```bash
# Generate a secure random string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Production Deployment

### Build for Production

```bash
npm run build
npm start
```

### Environment Setup

1. Set all required environment variables
2. Use strong JWT_SECRET (32+ random characters)
3. Use strong database password
4. Configure CORS_ORIGIN to frontend URL
5. Set NODE_ENV=production

### Database Backup

```bash
# Backup
pg_dump approval_central > backup.sql

# Restore
psql approval_central < backup.sql
```

### Monitoring

- Monitor error logs
- Track request latency
- Monitor database query performance
- Set up alerts for failed operations

## Performance Tips

- Enable query logging to identify slow queries
- Add indexes for frequently filtered columns
- Use connection pooling in production
- Monitor memory usage
- Cache frequently accessed data

## Development Workflow

1. Make changes to TypeScript files
2. Development server auto-reloads on save
3. Fix any TypeScript errors
4. Test API endpoints with curl or Postman
5. Commit changes to git

## Testing

Manually test endpoints using curl:

```bash
# Health check
curl http://localhost:4000/health

# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}'

# Get profile (with token)
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:4000/api/auth/me
```

## Frontend Integration

From the repo root, run the Vite frontend:

```bash
cd ../frontend
npm run dev
```

The Vite dev server (port 5173) automatically proxies `/api` to `http://localhost:4000`.

For complete instructions, see the [root README.md](../README.md).

---

**API Version**: 1.0.0  
**Last Updated**: March 26, 2026
