# Approval Central

A comprehensive approval request management system built with React (frontend) and Express (backend). The system allows users to create, approve, reject, and track approval requests with customizable workflows.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Development](#development)
- [Building for Production](#building-for-production)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [API Documentation](#api-documentation)
- [Support & Contributing](#support--contributing)
- [License](#license)

---

## Overview

Approval Central is an enterprise-grade approval workflow management system designed to streamline the process of creating and managing approval requests across departments. It features:

- **Role-based access control** with granular permissions
- **Multi-step approval chains** with configurable workflows
- **Rich forms** with custom field types and validation
- **Real-time request tracking** and status updates
- **Comprehensive audit logs** for compliance
- **Production-ready security** with JWT authentication

---

## Features

### Core Features

-  User authentication with JWT tokens
-  Role-based access control (RBAC)
-  Create and manage approval requests
-  Configurable approval chains with multiple steps
-  Custom form fields (text, number, date, select, radio, checkbox, textarea)
-  Rich text editor for request content
-  Line items (repeatable field groups)
-  Request filtering and search
-  Multi-department support
-  Approval action history
-  Audit logging for compliance

### Admin Features

-  User management and role assignment
-  Approval type configuration
-  Approval chain creation
-  Department management
-  Audit log viewing
-  System settings (company name, logo)

### Security Features

-  JWT-based authentication with token expiration
-  bcryptjs password hashing
-  CORS configuration
-  Security headers
-  SQL injection prevention (parameterized queries)
-  Input validation with Zod
-  XSS protection via safe HTML handling
-  Comprehensive audit logging

---

## Tech Stack

### Frontend

- **React 18** with TypeScript
- **Vite** for fast development and optimized builds
- **TailwindCSS** for styling
- **TipTap** for rich text editing
- **Shadcn/UI** for component library
- **React Router** for navigation
- **Sonner** for notifications

### Backend

- **Express.js** for REST APIs
- **Node.js** with TypeScript
- **PostgreSQL** for the database
- **JWT** for authentication
- **bcryptjs** for password hashing
- **Zod** for schema validation
- **CORS** for cross-origin requests

### Development Tools

- **ESLint** for code quality
- **TypeScript** for type safety
- **tsx** for TypeScript execution

---

## Prerequisites

- **Node.js** 20.0 or higher
- **npm** 10.0 or higher
- **PostgreSQL** 14.0 or higher
- **Git** for version control

### System Requirements

- **OS**: Windows, macOS, or Linux
- **RAM**: 4GB minimum (8GB recommended)
- **Disk Space**: 2GB for dependencies and database

---

## Project Structure

```
approval-central/
 backend/                    # Express API server
    src/
       index.ts           # Main server entry point
       env.ts             # Environment configuration
       db.ts              # Database connection
       httpError.ts       # Custom HTTP error class
       asyncHandler.ts    # Async error wrapper
       asyncMiddleware.ts # Async middleware wrapper
       verifyDb.ts        # Database verification
       auth/
          jwt.ts         # JWT token utilities
          password.ts    # Password hashing
       middleware/
          auth.ts        # Authentication middleware
       routes/
           api.ts         # API endpoints
    sql/
       complete-schema.sql # Full database schema
       migrations/        # Optional incremental migrations
    scripts/
       apply-schema.ts    # Full schema setup script
       run-migrations.ts  # Incremental migration runner
    .env.example           # Backend environment template
    package.json           # Backend dependencies and scripts
    tsconfig.json          # Backend TypeScript config

 frontend/                   # React Vite application
    src/
       main.tsx           # Vite entry point
       App.tsx            # Main app component
       pages/             # Page components
       components/        # Reusable components
       contexts/          # React contexts
       hooks/             # Custom hooks
       lib/               # Utilities and API client
       integrations/      # External service integrations
       test/              # Test files
    public/                # Static assets
    .env.example           # Frontend environment template
    package.json           # Frontend dependencies and scripts
    tsconfig.app.json      # Frontend TypeScript config
    tsconfig.json
    vite.config.ts         # Vite configuration

 .gitignore                 # Git ignore file
 README.md                  # This file
 SECURITY_SETUP.md          # Security configuration guide
```

---

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd approval-central
```

### 2. Setup Backend

```bash
cd backend
cp .env.example .env
npm install
npm run build
```

> Edit `backend/.env` before starting the backend. See [Backend Configuration](#backend-configuration-env) below.

### 3. Setup Database

```bash
cd backend
npm run db:schema
```

If you are using incremental migrations instead of the complete schema file, run:

```bash
npm run db:migrate
```

### 4. Setup Frontend

```bash
cd ../frontend
cp .env.example .env
npm install
```

---

## Configuration

### Backend Configuration (`backend/.env`)

Create or update `backend/.env` with your local values:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/approval_central
JWT_SECRET=your-very-long-random-secret
PORT=4000
CORS_ORIGIN=http://localhost:8080
NODE_ENV=development
```

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret used to sign JWT tokens
- `PORT`: Backend port, default `4000`
- `CORS_ORIGIN`: Frontend origin allowed to call the backend
- `NODE_ENV`: Typically `development` or `production`

### Frontend Configuration (`frontend/.env`)

The frontend uses the Vite dev proxy to forward `/api` requests to the backend:

```bash
# Leave empty to use same-origin /api via proxy to http://localhost:4000
# VITE_API_URL=
```

Set `VITE_API_URL` when your backend is hosted on a different URL in development or production.

---

## Database Setup

### Create the database

```bash
createdb approval_central
```

or:

```sql
CREATE DATABASE approval_central;
```

### Apply the schema

```bash
cd backend
npm run db:schema
```

### Run migrations

Use this command if you have incremental migrations:

```bash
cd backend
npm run db:migrate
```

---

## Running the Application

### Development Mode

**Terminal 1: Start the backend**

```bash
cd backend
npm run dev
```

**Terminal 2: Start the frontend**

```bash
cd frontend
npm run dev
```

Default URLs:

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:4000`

If port `8080` is already in use, Vite will choose the next available port, such as `http://localhost:8081`.

### Initial Admin Setup

Open the frontend and navigate to:

- `http://localhost:8080/setup`

Create the first administrator account through the setup page.

### Production Deployment

#### Backend Deployment

1. **Build the backend:**
   ```bash
   cd backend
   npm run build
   ```

2. **Configure environment variables:**
   - Copy `backend/.env.example` to `backend/.env`
   - Set `DATABASE_URL` to your production database
   - Set `JWT_SECRET` to a secure random string
   - Set `CORS_ORIGIN` to your frontend domain (e.g., `https://yourdomain.com`)
   - Set `NODE_ENV=production`

3. **Start the backend:**
   ```bash
   npm start
   ```

#### Frontend Deployment

1. **Build the frontend:**
   ```bash
   cd frontend
   npm run build
   ```

2. **Configure environment variables:**
   - Copy `frontend/.env.example` to `frontend/.env`
   - Set `VITE_API_URL` to your backend API URL (e.g., `https://api.yourdomain.com`)

3. **Deploy the `dist/` folder:**
   - Upload the contents of `frontend/dist/` to your web server
   - Configure your web server to serve the static files
   - Set up SSL certificates for HTTPS

#### Example Nginx Configuration

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    root /path/to/frontend/dist;
    index index.html;

    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/private.key;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Docker Deployment (Optional)

**backend/Dockerfile:**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 4000
CMD ["npm", "start"]
```

**frontend/Dockerfile:**
```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"
```

The production build is available in `frontend/dist/`.

#### Backend Deployment

1. **Build the backend:**
   ```bash
   cd backend
   npm run build
   ```

2. **Configure environment variables:**
   - Copy `backend/.env.example` to `backend/.env`
   - Set `DATABASE_URL` to your production database
   - Set `JWT_SECRET` to a secure random string
   - Set `CORS_ORIGIN` to your frontend domain (e.g., `https://yourdomain.com`)
   - Set `NODE_ENV=production`

3. **Start the backend:**
   ```bash
   npm start
   ```

#### Frontend Deployment

1. **Build the frontend:**
   ```bash
   cd frontend
   npm run build
   ```

2. **Configure environment variables:**
   - Copy `frontend/.env.example` to `frontend/.env`
   - Set `VITE_API_URL` to your backend API URL (e.g., `https://api.yourdomain.com`)

3. **Deploy the `dist/` folder:**
   - Upload the contents of `frontend/dist/` to your web server
   - Configure your web server to serve the static files
   - Set up SSL certificates for HTTPS

#### Example Nginx Configuration

```nginx
# Frontend (port 80/443)
server {
    listen 443 ssl;
    server_name yourdomain.com;
    root /path/to/frontend/dist;
    index index.html;

    # SSL configuration
    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/private.key;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to backend
    location /api {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Backend API (internal, port 4000)
# The backend runs on localhost:4000 and is proxied through the frontend
```

#### Docker Deployment (Optional)

**backend/Dockerfile:**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 4000
CMD ["npm", "start"]
```

**frontend/Dockerfile:**
```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

The production build is available in `frontend/dist/`.

---

## Development

### Linting

```bash
cd frontend
npm run lint
```

### TypeScript Checking

```bash
cd frontend
npx tsc --noEmit
cd ../backend
npm run build
```

### Testing

```bash
cd frontend
npm run test
npm run test:watch
```

---

## Building for Production

### Environment Configuration

1. **Backend Environment Variables**:
   - Copy `backend/.env.example` to `backend/.env`
   - Configure your production database URL, JWT secrets, and other settings

2. **Frontend Environment Variables**:
   - Copy `frontend/.env.example` to `frontend/.env`
   - Set `VITE_API_URL` to your production backend URL (e.g., `https://api.yourdomain.com`)

### Backend Deployment

```bash
cd backend
npm install --production
npm run build
npm start
```

The backend will run on the port specified by the `PORT` environment variable (default: 4000).

### Frontend Deployment

```bash
cd frontend
npm install --production
npm run build
```

This creates a `dist/` directory with static files that can be served by any web server (nginx, Apache, etc.).

**Example nginx configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /path/to/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Docker Deployment (Optional)

If you prefer containerized deployment, you can create Dockerfiles for both services:

**backend/Dockerfile:**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
EXPOSE 4000
CMD ["npm", "start"]
```

**frontend/Dockerfile:**
```dockerfile
FROM nginx:alpine
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Production Checklist

- [ ] Set secure JWT secrets
- [ ] Configure production database
- [ ] Set up SSL/TLS certificates
- [ ] Configure CORS for your domain
- [ ] Set up proper logging and monitoring
- [ ] Configure backup strategies for database
- [ ] Test all features in production environment

---

## Database

The database schema includes the application’s core entities:

- `users` - Authentication records
- `profiles` - User profile details, roles, and permissions
- `roles` - Role definitions and permissions
- `departments` - Department metadata
- `approval_types` - Definitions for request types
- `approval_chains` - Multi-step workflow definitions
- `approval_requests` - Submitted requests
- `approval_actions` - Approval history
- `audit_logs` - Audit trails and activity logs

### Backup and restore

```bash
pg_dump -h localhost -U username approval_central > backup.sql
psql -h localhost -U username approval_central < backup.sql
```

---

## Security

The application includes these security measures:

- **JWT authentication** with expiration
- **Password hashing** using `bcryptjs`
- **Parameterized SQL queries** to prevent injection
- **CORS** limited to the frontend origin
- **Input validation** with Zod
- **Audit logging** for important actions
- **Secrets stored in `.env` files** and not committed to git

For detailed security guidance, see [SECURITY_SETUP.md](./SECURITY_SETUP.md).

---

## Troubleshooting

### Backend issues

- **`DATABASE_URL is required`**
  - Make sure `backend/.env` exists and includes `DATABASE_URL`
  - Confirm PostgreSQL is running
- **`EADDRINUSE`**
  - Stop the process using port `4000`
  - Change `PORT` in `backend/.env`
- **`Cannot find module`**
  - Run `npm install` in `backend`

### Frontend issues

- **Module not found**
  - Run `npm install` in `frontend`
- **CORS errors**
  - Verify backend is reachable at `http://localhost:4000`
  - Confirm `CORS_ORIGIN` is `http://localhost:8080`
- **Blank page or build errors**
  - Clear browser cache
  - Rebuild frontend with `npm run build`

### Database issues

- **Database does not exist**
  - Create it with `createdb approval_central`
- **`pgcrypto` extension missing**
  - Enable it manually with:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

---

## API Documentation

### Setup

- `GET /api/setup/status` - Check whether setup is complete
- `POST /api/setup` - Create the first administrator account

### Authentication

- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Current user profile
- `PATCH /api/auth/me/password` - Change password

### Admin

- `GET /api/users` - List users
- `POST /api/users` - Create a user
- `GET /api/approval-types` - List approval types
- `POST /api/approval-types` - Create approval type

---

## Support & Contributing

### Reporting issues

1. Search existing issues first
2. Include reproduction steps
3. Provide environment details (OS, Node version, database, ports)

### Contributing

1. Create a feature branch
2. Keep code typed and linted
3. Update documentation
4. Test locally
5. Open a PR with a clear description

---

## License

[Your License Here]

---

## Quick Start Checklist

- [ ] Clone repository
- [ ] Install Node.js 20+
- [ ] Install PostgreSQL
- [ ] Create `backend/.env` and `frontend/.env`
- [ ] Install dependencies in `backend` and `frontend`
- [ ] Apply database schema with `npm run db:schema`
- [ ] Start backend with `npm run dev`
- [ ] Start frontend with `npm run dev`
- [ ] Open the app in the browser
- [ ] Complete initial admin setup at `/setup`

---

**Last Updated**: April 18, 2026
**Version**: 1.0.0
