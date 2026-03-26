# Security Setup & Environment Configuration

## ⚠️ CRITICAL: .env Files Removed from Git

### What Was Done

- Updated `.gitignore` files in both `backend/` and `frontend/` to properly exclude all `.env` files
- Removed `backend/.env` and `frontend/.env` from git tracking using `git rm --cached`
- Updated .gitignore patterns to include:
  - `.env` (root env file)
  - `.env.local` (local overrides)
  - `.env.*.local` (environment-specific local files)
  - `.env.production`, `.env.development` (environment-specific files)
  - `.env.*.example` (example files are allowed)

### Next Steps: Commit Changes

Run the following commands to commit these security fixes:

```bash
# Review the changes one more time
git status

# Commit the removal of .env files and updated .gitignore
git add .
git commit -m "security: remove .env files from git tracking

- Removed backend/.env from git index
- Removed frontend/.env from git index
- Updated .gitignore to comprehensively exclude all environment files
- .env.example files are preserved for documentation
- BREAKING: Anyone with access to git history can still see old .env values"
```

### Optional: Remove from Full Git History

If you want to completely remove `.env` files from git history (including all past commits):

```bash
# Install git-filter-repo (recommended over git filter-branch)
# On Windows PowerShell:
pip install git-filter-repo

# Remove .env files from all history
git filter-repo --path backend/.env --invert-paths
git filter-repo --path frontend/.env --invert-paths

# Force push to remote (use with caution!)
git push origin --force-with-lease
```

⚠️ **WARNING**: Force pushing rewrites history and requires all team members to re-clone the repository.

### Additional Security Recommendations

1. **Rotate Secrets**: If you pushed any real secrets:
   - Regenerate JWT_SECRET
   - Reset database passwords
   - Change any API keys that were exposed

2. **Monitor Repository**:
   - Check git history for sensitive data
   - Use GitHub's secret scanning feature

3. **Local Setup Instructions for Team**:

```bash
# Clone repository
git clone <repo-url>
cd Portals

# Backend setup
cd backend
cp .env.example .env
# Edit .env with your actual configuration
npm install
npm run build

# Frontend setup
cd ../frontend
cp .env.example .env
# If .env.example provided, edit with VITE_API_URL
npm install
npm run build
```

## Environment Variables Required

### Backend (.env in backend/)

```
# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@localhost:5432/approval_central

# Security
JWT_SECRET=your-super-secret-key-min-32-chars-random-string
NODE_ENV=development

# Server
PORT=4000

# CORS
CORS_ORIGIN=http://localhost:5173
```

### Frontend (.env in frontend/)

```
# API URL (optional if using Vite proxy in dev)
VITE_API_URL=http://localhost:4000
```

## Verification Checklist

- [x] .gitignore updated to ignore .env files
- [x] .env files removed from git tracking
- [x] .env.example files preserved for documentation
- [ ] Run `git log --name-only --pretty=format:` to verify old commits still have them (for awareness)
- [ ] Create new commits with security fixes
- [ ] Team members pull latest changes and update their local .env files
- [ ] Secrets rotated/regenerated if any were exposed
- [ ] Production deployment verified with new secrets

## .gitignore Patterns Explained

```gitignore
# Core environment files - NEVER commit
.env              # Main environment file
.env.local        # Local machine overrides
.env.*.local      # Environment-specific overrides
.env.production   # Production configuration
.env.development  # Development configuration

# Allow example/template files
!.env.example                # Template for developers
!.env.*.example              # Environment-specific templates
```

## Going Forward

- **Never add .env to git**: The updated .gitignore prevents this
- **Never commit secrets**: Use .env files only
- **Share .env.example**: Show required variables without values
- **Use environment variables**: Reference from `.env` files in all configurations
- **Rotate secrets regularly**: Change JWT_SECRET, passwords, tokens periodically

## Reference Files

- Check `backend/.env.example` for required backend variables
- Check `frontend/.env.example` for required frontend variables
