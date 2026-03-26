# Approval Central

A comprehensive approval request management system built with React (frontend) and Express (backend). The system allows users to create, approve, reject, and track approval requests with customizable workflows.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Development](#development)
- [Building for Production](#building-for-production)
- [Database](#database)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## 🎯 Overview

Approval Central is an enterprise-grade approval workflow management system designed to streamline the process of creating and managing approval requests across departments. It features:

- **Role-based access control** with granular permissions
- **Multi-step approval chains** with configurable workflows
- **Rich forms** with custom field types and validation
- **Real-time request tracking** and status updates
- **Comprehensive audit logs** for compliance
- **Production-ready security** with JWT authentication

---

## ✨ Features

### Core Features

- ✅ User authentication with JWT tokens
- ✅ Role-based access control (RBAC)
- ✅ Create and manage approval requests
- ✅ Configurable approval chains with multiple steps
- ✅ Custom form fields (text, number, date, select, radio, checkbox, textarea)
- ✅ Rich text editor for request content
- ✅ Line items (repeatable field groups)
- ✅ Request filtering and search
- ✅ Multi-department support
- ✅ Approval action history
- ✅ Audit logging for compliance

### Admin Features

- 👥 User management and role assignment
- 📋 Approval type configuration
- ⛓️ Approval chain creation
- 🏢 Department management
- 📊 Audit log viewing
- ⚙️ System settings (company name, logo)

### Security Features

- 🔐 JWT-based authentication with 7-day expiration
- 🔒 bcryptjs password hashing (10 rounds)
- 🛡️ CORS configuration
- 📝 Security headers
- 🚫 SQL injection prevention (parameterized queries)
- ✔️ Input validation with Zod
- 🔍 XSS protection via safe HTML handling
- 📋 Comprehensive audit logging

---

## 🛠 Tech Stack

### Frontend

- **React 18** with TypeScript
- **Vite** for fast development and optimized builds
- **TailwindCSS** for styling
- **TipTap** for rich text editing
- **Shadcn/UI** for component library
- **React Router** for navigation
- **Sonner** for notifications

### Backend

- **Express.js** for REST API
- **Node.js** with TypeScript
- **PostgreSQL** for database
- **JWT** for authentication
- **bcryptjs** for password hashing
- **Zod** for schema validation
- **CORS** for cross-origin requests

### Development Tools

- **ESLint** for code quality
- **TypeScript** for type safety
- **tsx** for TypeScript execution

---

## 📦 Prerequisites

- **Node.js** 20.0 or higher
- **npm** 10.0 or higher
- **PostgreSQL** 14.0 or higher (must have `pgcrypto` extension)
- **Git** for version control

### System Requirements

- **OS**: Windows, macOS, or Linux
- **RAM**: Minimum 4GB (8GB recommended)
- **Disk Space**: 2GB for dependencies and database

---

## 📁 Project Structure

```
Portals/
├── backend/                    # Express API server
│   ├── src/
│   │   ├── index.ts           # Main server entry point
│   │   ├── env.ts             # Environment configuration
│   │   ├── db.ts              # Database connection
│   │   ├── httpError.ts        # Custom HTTP error class
│   │   ├── asyncHandler.ts     # Async error wrapper
│   │   ├── asyncMiddleware.ts  # Async middleware wrapper
│   │   ├── verifyDb.ts         # Database verification
│   │   ├── auth/
│   │   │   ├── jwt.ts         # JWT token management
│   │   │   └── password.ts    # Password hashing
│   │   ├── middleware/
│   │   │   └── auth.ts        # Authentication middleware
│   │   └── routes/
│   │       └── api.ts         # API endpoints
│   ├── sql/
│   │   └── schema.sql         # Database schema
│   ├── scripts/
│   │   └── apply-schema.ts    # Schema setup script
│   ├── .env.example           # Environment template
│   ├── package.json           # Backend dependencies
│   └── tsconfig.json          # TypeScript config
│
├── frontend/                   # React Vite application
│   ├── src/
│   │   ├── main.tsx           # Vite entry point
│   │   ├── App.tsx            # Main app component
│   │   ├── pages/             # Page components
│   │   ├── components/        # Reusable components
│   │   ├── contexts/          # React contexts (Auth, Company)
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # Utilities and API client
│   │   ├── integrations/      # External service integrations
│   │   └── test/              # Test files
│   ├── public/                # Static assets
│   ├── .env.example           # Environment template
│   ├── package.json           # Frontend dependencies
│   └── vite.config.ts         # Vite configuration
│
├── .git/                      # Git repository
├── .gitignore                 # Git ignore file
├── README.md                  # This file
└── SECURITY_SETUP.md          # Security configuration guide
```

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd Portals
```

### 2. Setup Backend

```bash
cd backend

# Copy environment template
cp .env.example .env

# Install dependencies
npm install

# Build TypeScript
npm run build
```

**Edit `.env` with your configuration** (see [Configuration](#configuration) section)

### 3. Setup Database

```bash
# From the backend directory (still in ./backend)

# Create database schema
npm run db:schema
```

### 4. Setup Frontend

```bash
# From the root directory
cd frontend

# Copy environment template
cp .env.example .env

# Install dependencies
npm install
```

---

## ⚙️ Configuration

### Backend Configuration (.env)

Create or edit `backend/.env`:

```bash
# PostgreSQL Database (REQUIRED)
DATABASE_URL=postgresql://username:password@localhost:5432/approval_central

# JWT Secret for token signing (REQUIRED)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your-super-secret-random-string-at-least-32-chars

# Server Port (optional, default 4000)
PORT=4000

# Node Environment (development/production)
NODE_ENV=development

# CORS Origin - frontend URL (required)
CORS_ORIGIN=http://localhost:5173
```

### Frontend Configuration (.env)

Create or edit `frontend/.env`:

```bash
# API URL (optional if using Vite dev proxy)
# In development, Vite automatically proxies /api to http://localhost:4000
# VITE_API_URL=http://localhost:4000
```

### Database Setup

1. **Create PostgreSQL Database**

```bash
# Using psql
createdb approval_central

# Or with a query:
# CREATE DATABASE approval_central;
```

2. **Apply Schema**

```bash
cd backend
npm run db:schema
```

3. **Initial Admin User** (created by schema)

The schema will prompt you to create an initial admin user if needed.

---

## 🏃 Running the Application

### Development Mode (Recommended)

**Terminal 1: Start the Backend**

```bash
cd backend
npm run dev
```

Expected output:

```
approval-central-api listening on http://localhost:4000
```

**Terminal 2: Start the Frontend**

```bash
cd frontend
npm run dev
```

Expected output:

```
  VITE v7.3.1  ready in 500 ms
  ➜  Local:   http://localhost:5173/
```

### Access the Application

- **Frontend**: Open http://localhost:5173 in your browser
- **API**: http://localhost:4000/api

### Production Mode

**1. Build Backend**

```bash
cd backend
npm run build
npm start
```

**2. Build Frontend**

```bash
cd frontend
npm run build
```

The production frontend files are in `frontend/dist/`. Deploy these to your web server (Nginx, Apache, etc.).

---

## 🧑‍💻 Development

### Code Quality

Run linting:

```bash
cd frontend
npm run lint
```

### TypeScript Checking

```bash
# Frontend
cd frontend
npx tsc --noEmit

# Backend (part of build)
cd backend
npm run build
```

### Code Style

The project uses ESLint with TypeScript support. Most issues are auto-fixable:

```bash
npm run lint -- --fix
```

### Testing

Run frontend tests:

```bash
cd frontend
npm run test        # Run tests once
npm run test:watch  # Watch mode
```

---

## 📦 Building for Production

### Backend

```bash
cd backend

# Optimize build
npm run build

# Test the production build locally
PORT=4000 npm start
```

### Frontend

```bash
cd frontend

# Build for production (optimized, minified)
npm run build

# Preview the production build locally
npm run preview
```

---

## 🗄️ Database

### Database Schema

The application automatically creates all required tables when you run `npm run db:schema`:

- `profiles` - User accounts and roles
- `roles` - User roles with permissions
- `departments` - Organizational departments
- `approval_types` - Request type definitions
- `approval_chains` - Multi-step approval workflows
- `approval_requests` - Submitted requests
- `approval_actions` - Approval history
- `audit_logs` - System activity tracking

### Backup and Restore

```bash
# Backup database
pg_dump -h localhost -U username approval_central > backup.sql

# Restore from backup
psql -h localhost -U username approval_central < backup.sql
```

---

## 🔒 Security

The application implements comprehensive security measures:

- **Authentication**: JWT tokens with 7-day expiration
- **Password Security**: bcryptjs with 10 rounds, never stored in plain text
- **Database**: Parameterized SQL queries prevent injection attacks
- **Environment**: Sensitive variables in `.env` files (not in git)
- **CORS**: Configured to specific origins
- **Audit Logging**: All significant actions logged for compliance

For detailed security setup and best practices, see [SECURITY_SETUP.md](./SECURITY_SETUP.md).

---

## 🐛 Troubleshooting

### Backend Won't Start

**Error: "DATABASE_URL is required"**

- Ensure `backend/.env` exists and has `DATABASE_URL` set
- Verify PostgreSQL is running
- Test connection: `psql -c "SELECT 1"`

**Error: "Cannot find module"**

- Run `npm install` in the backend directory
- Delete `node_modules` and run `npm install` again

**Error: "EADDRINUSE: address already in use :::4000"**

- Port 4000 is occupied. Either:
  - Kill the process using port 4000
  - Change PORT in `.env`

### Frontend Won't Start

**Error: "Module not found"**

- Run `npm install` in the frontend directory
- Verify Node.js version: `node --version` (need 20+)

**Error: "API calls fail / CORS error"**

- Ensure backend is running on port 4000
- Check `CORS_ORIGIN` in backend `.env`
- In dev, Vite should auto-proxy `/api` to backend

**Blank page or 404**

- Clear browser cache: Ctrl+Shift+Delete
- Rebuild frontend: `npm run build && npm run preview`

### Database Issues

**Error: "database does not exist"**

- Create database: `createdb approval_central`
- Run schema: `cd backend && npm run db:schema`

**Error: "pgcrypto extension not found"**

- Enable extension:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  ```

---

## 📝 Development Workflow

1. **Create a feature branch**

   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes and commit**

   ```bash
   git add .
   git commit -m "feat: add my feature"
   ```

3. **Push and create pull request**

   ```bash
   git push origin feature/my-feature
   ```

4. **Code review and merge**

---

## 📚 API Documentation

### Authentication

All API endpoints (except `/health`) require Bearer token:

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     http://localhost:4000/api/auth/me
```

### Key Endpoints

**Auth**

- `POST /api/setup` - Initial admin setup
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Current user profile
- `PATCH /api/auth/me/password` - Change password

**Approval Requests**

- `GET /api/approval-requests` - List requests
- `POST /api/approval-requests` - Create request
- `GET /api/approval-requests/:id` - Get request details
- `POST /api/approval-requests/:id/actions` - Approve/reject

**Admin**

- `GET /api/users` - List users
- `POST /api/users` - Create user
- `GET /api/approval-types` - List request types
- `POST /api/approval-types` - Create type

---

## 📞 Support & Contributing

### Reporting Issues

1. Check existing issues in Git
2. Include error message and steps to reproduce
3. Specify your environment (OS, Node version, etc.)

### Contributing

1. Follow the code style (ESLint)
2. Write TypeScript with proper types
3. Update documentation
4. Test changes locally
5. Submit a PR with clear description

---

## 📄 License

[Your License Here]

---

## 🔗 Additional Resources

- [SECURITY_SETUP.md](./SECURITY_SETUP.md) - Security configuration and environment setup
- [backend/README.md](./backend/README.md) - Backend-specific documentation
- [frontend/README.md](./frontend/README.md) - Frontend-specific documentation

---

## ✅ Quick Start Checklist

- [ ] Clone repository
- [ ] Install Node.js 20+
- [ ] Install PostgreSQL
- [ ] Create `.env` files (copy from `.env.example`)
- [ ] Install dependencies (`npm install` in both directories)
- [ ] Create database and run schema
- [ ] Start backend (`npm run dev` in backend/)
- [ ] Start frontend (`npm run dev` in frontend/)
- [ ] Open http://localhost:5173
- [ ] Login or create initial admin user

---

**Last Updated**: March 26, 2026
**Version**: 1.0.0
