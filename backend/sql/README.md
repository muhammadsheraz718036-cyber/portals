# Database Schema & Migrations

This directory contains SQL schema files and migration scripts for the Approval Central database.

## 🎯 **Recommended: Complete Schema (New Databases)**

### Apply Complete Schema (Recommended for New Databases)
```bash
npm run db:schema
```
This runs `complete-schema.sql` which contains **ALL** tables, indexes, constraints, and migrations in a single file.

**Benefits:**
- ✅ One command setup
- ✅ Includes everything (base schema + all migrations)
- ✅ Idempotent (safe to run multiple times)
- ✅ Automatic verification
- ✅ No migration order issues

## 📚 **Individual Migrations (Existing Databases)**

### Run All Migrations (For Existing Databases)
```bash
npm run db:migrate
```
This command runs individual migrations in order and tracks which have been executed.

**Use this only if:**
- You have an existing database
- You need incremental migrations
- You're upgrading from an older version

## 📁 Files Overview

### 🎯 **Complete Schema**
- **`complete-schema.sql`** - ⭐ **COMPLETE DATABASE SETUP**
  - All 13 tables
  - All 15+ indexes
  - All constraints and checks
  - All migrations consolidated
  - Verification queries included

### 📚 **Individual Files** (Legacy)
- `schema.sql` - Original base schema (deprecated)
- `migrate.sql` - Master migration script (deprecated)
- `add-page-layout.sql` - Adds page layout column to approval_types
- `add-password-management.sql` - Adds password management columns to profiles
- `add-salutations.sql` - Adds salutation columns to approval_types
- `add-file-attachments.sql` - Adds file attachment tables and functionality
- `add-action-resubmitted-status.sql` - Adds resubmitted status to approval actions
- `add-approval-type-department.sql` - Adds department association to approval types
- `add-company-phone-settings.sql` - Adds phone settings to company settings
- `add-company-contact-department.sql` - Adds contact department to company settings
- `fix-status-constraints.sql` - Fixes status check constraints

## 📊 What's Included in Complete Schema

### Tables (13 total):
- `users`, `departments`, `roles`, `profiles`
- `approval_types`, `approval_chains`, `approval_requests`, `approval_actions`
- `audit_logs`, `company_settings`
- `approval_type_attachments`, `request_attachments`
- `migration_log`

### Features:
- ✅ File attachments support
- ✅ Password management & account locking
- ✅ Company settings with phone/contact
- ✅ Page layout support (portrait/landscape)
- ✅ Salutations for approval letters
- ✅ Status constraints for proper workflow
- ✅ Request number generation
- ✅ Approval chain automation
- ✅ Migration tracking
- ✅ Automatic verification

## 🔧 How It Works

### Complete Schema (`npm run db:schema`)
1. Executes `complete-schema.sql`
2. Creates all tables with `IF NOT EXISTS`
3. Applies all indexes and constraints
4. Runs verification queries
5. Inserts initial data
6. Records schema application in migration log

### Individual Migrations (`npm run db:migrate`)
1. Checks `migration_log` table for executed migrations
2. Skips already-run migrations
3. Executes pending migrations in order
4. Records successful migrations
5. Shows execution summary

## 🚀 Quick Start

### New Database (Recommended):
```bash
cd backend
npm run db:schema
# ✅ Everything is ready!
```

### Existing Database:
```bash
cd backend
npm run db:migrate
# ✅ All pending migrations applied
```

## 📋 Migration Order (Individual)

1. page_layout
2. password_management  
3. salutations
4. file_attachments
5. action_resubmitted_status
6. approval_type_department
7. company_phone_settings
8. company_contact_department
9. fix_status_constraints

## ✅ Verification

The complete schema includes automatic verification that confirms:
- All 13 tables created successfully
- All 15+ indexes created
- All constraints properly applied

---

**💡 Recommendation:** Use `complete-schema.sql` for all new setups. Individual migrations are maintained for backward compatibility with existing databases.
