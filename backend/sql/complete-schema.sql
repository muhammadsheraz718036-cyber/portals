-- Approval Central — Complete Database Schema (Consolidated)
-- This file contains the base schema plus all migrations
-- Apply to an empty database: psql $DATABASE_URL -f sql/complete-schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===============================
-- BASE TABLES
-- ===============================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  head_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  locked_at TIMESTAMPTZ,
  last_failed_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  fields JSONB NOT NULL DEFAULT '[]',
  page_layout VARCHAR(20) DEFAULT 'portrait',
  pre_salutation TEXT,
  post_salutation TEXT,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  allow_attachments BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  approval_type_id UUID NOT NULL REFERENCES approval_types(id) ON DELETE CASCADE,
  steps JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT NOT NULL UNIQUE,
  approval_type_id UUID REFERENCES approval_types(id) NOT NULL,
  approval_chain_id UUID REFERENCES approval_chains(id),
  initiator_id UUID REFERENCES users(id) NOT NULL,
  department_id UUID REFERENCES departments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected', 'changes_requested')),
  current_step INTEGER NOT NULL DEFAULT 1,
  total_steps INTEGER NOT NULL DEFAULT 1,
  form_data JSONB NOT NULL DEFAULT '{}',
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES approval_requests(id) ON DELETE CASCADE NOT NULL,
  step_order INTEGER NOT NULL,
  role_name TEXT NOT NULL,
  action_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped', 'changes_requested', 'resubmitted')),
  acted_by UUID REFERENCES users(id),
  comment TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL DEFAULT 'ApprovalHub',
  logo_url TEXT,
  phone_number TEXT,
  landline_number TEXT,
  contact_department TEXT DEFAULT 'MIS Department',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ===============================
-- FILE ATTACHMENTS (Migration: add-file-attachments.sql)
-- ===============================

CREATE TABLE IF NOT EXISTS approval_type_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_type_id UUID NOT NULL REFERENCES approval_types(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  max_file_size_mb INTEGER NOT NULL DEFAULT 10,
  allowed_extensions TEXT[] DEFAULT '{pdf,doc,docx,xls,xlsx,jpg,jpeg,png}',
  max_files INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  approval_type_attachment_id UUID NOT NULL REFERENCES approval_type_attachments(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===============================
-- INDEXES
-- ===============================

CREATE INDEX IF NOT EXISTS idx_profiles_department ON profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_is_locked ON profiles(is_locked) WHERE is_locked = true;
CREATE INDEX IF NOT EXISTS idx_approval_requests_initiator ON approval_requests(initiator_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_type ON approval_requests(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_chain ON approval_requests(approval_chain_id);
CREATE INDEX IF NOT EXISTS idx_approval_actions_request ON approval_actions(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_chains_type ON approval_chains(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_types_department_id ON approval_types(department_id);
CREATE INDEX IF NOT EXISTS idx_approval_type_attachments_type ON approval_type_attachments(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_request ON request_attachments(request_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_field ON request_attachments(request_id, field_name);

-- ===============================
-- FUNCTIONS AND TRIGGERS
-- ===============================

CREATE OR REPLACE FUNCTION generate_request_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.request_number := 'REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('request_number_seq')::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS request_number_seq START 1;

DROP TRIGGER IF EXISTS set_request_number ON approval_requests;
CREATE TRIGGER set_request_number
  BEFORE INSERT ON approval_requests
  FOR EACH ROW
  EXECUTE PROCEDURE generate_request_number();

CREATE OR REPLACE FUNCTION create_approval_actions_for_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chain_steps jsonb;
  step_rec jsonb;
  step_num int := 0;
  i int := 0;
  n int;
  initiator_role_name TEXT;
  step_status TEXT;
BEGIN
  IF NEW.approval_chain_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the initiator's role name
  SELECT r.name INTO initiator_role_name
  FROM roles r
  JOIN profiles p ON p.role_id = r.id
  WHERE p.id = NEW.initiator_id;

  SELECT steps::jsonb INTO chain_steps
  FROM approval_chains
  WHERE id = NEW.approval_chain_id;

  IF chain_steps IS NULL OR jsonb_typeof(chain_steps) != 'array' THEN
    RETURN NEW;
  END IF;

  n := jsonb_array_length(chain_steps);
  IF n IS NULL OR n = 0 THEN
    RETURN NEW;
  END IF;

  WHILE i < n LOOP
    step_rec := chain_steps->i;
    step_num := step_num + 1;
    
    -- Determine step status
    -- If the step's role matches the initiator's role, skip it
    IF COALESCE(step_rec->>'roleName', '') = COALESCE(initiator_role_name, '') THEN
      step_status := 'skipped';
    ELSE
      -- Parallel approval: all non-skipped steps are pending
      step_status := 'pending';
    END IF;

    INSERT INTO approval_actions (
      request_id,
      step_order,
      role_name,
      action_label,
      status
    )
    VALUES (
      NEW.id,
      CASE
        WHEN step_rec->>'order' ~ '^[0-9]+$' THEN (step_rec->>'order')::int
        ELSE step_num
      END,
      COALESCE(step_rec->>'roleName', ''),
      COALESCE(step_rec->>'action', 'Review'),
      step_status
    );
    i := i + 1;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_approval_actions ON approval_requests;
CREATE TRIGGER trg_create_approval_actions
  AFTER INSERT ON approval_requests
  FOR EACH ROW
  EXECUTE PROCEDURE create_approval_actions_for_request();

-- ===============================
-- INITIAL DATA
-- ===============================

INSERT INTO company_settings (company_name)
SELECT 'ApprovalHub'
WHERE NOT EXISTS (SELECT 1 FROM company_settings LIMIT 1);

-- ===============================
-- MIGRATION LOG
-- ===============================

CREATE TABLE IF NOT EXISTS migration_log (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(migration_name)
);

-- Record that this consolidated schema has been applied
INSERT INTO migration_log (migration_name) 
VALUES ('consolidated-schema-2024-04-06') 
ON CONFLICT (migration_name) DO NOTHING;

-- ===============================
-- VERIFICATION QUERIES
-- ===============================

-- Verify all tables exist
DO $$
DECLARE
    table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name IN (
        'users', 'departments', 'roles', 'profiles', 'approval_types', 
        'approval_chains', 'approval_requests', 'approval_actions', 
        'audit_logs', 'company_settings', 'approval_type_attachments', 
        'request_attachments', 'migration_log'
    );
    
    IF table_count = 13 THEN
        RAISE NOTICE '✓ All 13 tables created successfully';
    ELSE
        RAISE NOTICE '✗ Expected 13 tables, found %', table_count;
    END IF;
END $$;

-- Verify all indexes exist
DO $$
DECLARE
    index_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes 
    WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%';
    
    IF index_count >= 15 THEN
        RAISE NOTICE '✓ All indexes created successfully';
    ELSE
        RAISE NOTICE '✗ Expected at least 15 indexes, found %', index_count;
    END IF;
END $$;

-- Verify constraints exist
DO $$
DECLARE
    constraint_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO constraint_count
    FROM information_schema.check_constraints 
    WHERE constraint_name IN ('approval_requests_status_check', 'approval_actions_status_check');
    
    IF constraint_count = 2 THEN
        RAISE NOTICE '✓ All check constraints created successfully';
    ELSE
        RAISE NOTICE '✗ Expected 2 check constraints, found %', constraint_count;
    END IF;
END $$;

DO $$
BEGIN
    RAISE NOTICE '🎉 Complete schema setup finished!';
END $$;
