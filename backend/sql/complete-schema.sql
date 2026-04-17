-- Approval Central — Complete Database Schema (Consolidated)
-- This file contains all base tables, migrations, and the latest feature updates
-- Apply to an empty database: psql $DATABASE_URL -f sql/complete-schema.sql
-- No need to run individual migrations - everything is here!

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
  changes_requested_by UUID REFERENCES users(id),
  changes_requested_at TIMESTAMPTZ,
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
  approver_user_id UUID REFERENCES users(id),
  acted_by UUID REFERENCES users(id),
  comment TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure column exists on pre-existing databases
ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS approver_user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_approval_actions_approver_user ON approval_actions(approver_user_id);
CREATE INDEX IF NOT EXISTS idx_approval_actions_request_step ON approval_actions(request_id, step_order);

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
-- MIGRATION 002: DYNAMIC APPROVER RESOLUTION
-- ===============================

-- Approval steps definition
CREATE TABLE IF NOT EXISTS approval_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id UUID NOT NULL REFERENCES approval_chains(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER')),
  actor_value TEXT,
  action_label TEXT NOT NULL DEFAULT 'Approve',
  due_days INTEGER DEFAULT 3,
  is_parallel BOOLEAN DEFAULT false,
  parallel_group TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chain_id, step_order)
);

-- Request steps (NEW: tracks which users are assigned to which steps)
CREATE TABLE IF NOT EXISTS request_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  step_id UUID REFERENCES approval_steps(id),
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  actor_type TEXT NOT NULL,
  actor_value TEXT,
  action_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SKIPPED')),
  assigned_to UUID REFERENCES profiles(id),
  acted_by UUID REFERENCES profiles(id),
  remarks TEXT,
  action_data JSONB DEFAULT '{}',
  due_date TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  resumed_from_step_id UUID REFERENCES request_steps(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Department manager assignments (CRITICAL: for new visibility feature)
CREATE TABLE IF NOT EXISTS department_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES profiles(id),
  UNIQUE(department_id, user_id)
);

-- User manager relationships
CREATE TABLE IF NOT EXISTS user_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES profiles(id),
  UNIQUE(user_id, manager_id)
);

-- User roles junction table (for multiple roles per user)
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES profiles(id),
  UNIQUE(user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);

-- ===============================
-- MIGRATION 004: BACKWARD COMPATIBILITY LOGGING
-- ===============================

CREATE TABLE IF NOT EXISTS deprecation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT NOT NULL,
  warning_message TEXT NOT NULL,
  step_name TEXT,
  step_order INTEGER,
  request_id UUID REFERENCES approval_requests(id),
  user_id UUID REFERENCES users(id),
  additional_data JSONB DEFAULT '{}',
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT NOT NULL,
  item_id UUID NOT NULL,
  old_value TEXT,
  new_value TEXT,
  migrated_by TEXT NOT NULL,
  migration_status TEXT DEFAULT 'success',
  error_message TEXT,
  additional_data JSONB DEFAULT '{}',
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===============================
-- BACKWARD COMPATIBILITY VIEW
-- ===============================

CREATE OR REPLACE VIEW approval_actions_view AS
SELECT 
  rs.id,
  rs.request_id,
  rs.step_order,
  COALESCE(
    CASE 
      WHEN rs.actor_type = 'ROLE' THEN rs.actor_value
      WHEN rs.actor_type = 'DEPARTMENT_MANAGER' THEN 'Department Manager'
      WHEN rs.actor_type = 'USER_MANAGER' THEN 'User Manager'
      ELSE rs.actor_value
    END,
    'Unknown'
  ) as role_name,
  rs.action_label,
  rs.status,
  rs.acted_by,
  rs.remarks as comment,
  rs.completed_at as acted_at,
  rs.created_at
FROM request_steps rs;

-- ===============================
-- INDEXES FOR BASE TABLES
-- ===============================

CREATE INDEX IF NOT EXISTS idx_profiles_department ON profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_is_locked ON profiles(is_locked) WHERE is_locked = true;
CREATE INDEX IF NOT EXISTS idx_approval_requests_initiator ON approval_requests(initiator_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_department ON approval_requests(department_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_type ON approval_requests(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_chain ON approval_requests(approval_chain_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_actions_request ON approval_actions(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_chains_type ON approval_chains(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_types_department_id ON approval_types(department_id);
CREATE INDEX IF NOT EXISTS idx_approval_type_attachments_type ON approval_type_attachments(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_request ON request_attachments(request_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_field ON request_attachments(request_id, field_name);

-- ===============================
-- INDEXES FOR NEW VISIBILITY FEATURE
-- ===============================

-- Critical indexes for new request visibility feature (department scoping)
CREATE INDEX IF NOT EXISTS idx_request_steps_request_assigned ON request_steps(request_id, assigned_to, status) 
  WHERE status IN ('PENDING', 'WAITING');
CREATE INDEX IF NOT EXISTS idx_request_steps_assigned_to_status ON request_steps(assigned_to, status) 
  WHERE status IN ('PENDING', 'WAITING');
CREATE INDEX IF NOT EXISTS idx_request_steps_acted_by ON request_steps(acted_by);
CREATE INDEX IF NOT EXISTS idx_department_managers_dept_active ON department_managers(department_id, is_active) 
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_department_managers_user_active ON department_managers(user_id, is_active) 
  WHERE is_active = true;

-- Indexes for approval steps and dynamic resolution
CREATE INDEX IF NOT EXISTS idx_approval_steps_chain_order ON approval_steps(chain_id, step_order);
CREATE INDEX IF NOT EXISTS idx_request_steps_request_order ON request_steps(request_id, step_order);
CREATE INDEX IF NOT EXISTS idx_request_steps_status ON request_steps(status) WHERE status IN ('PENDING', 'WAITING');
CREATE INDEX IF NOT EXISTS idx_user_managers_user_active ON user_managers(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_managers_manager_id ON user_managers(manager_id, is_active) WHERE is_active = true;

-- Indexes for logging tables
CREATE INDEX IF NOT EXISTS idx_deprecation_logs_component ON deprecation_logs(component);
CREATE INDEX IF NOT EXISTS idx_deprecation_logs_logged_at ON deprecation_logs(logged_at);
CREATE INDEX IF NOT EXISTS idx_deprecation_logs_request_id ON deprecation_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_migration_logs_component ON migration_logs(component);
CREATE INDEX IF NOT EXISTS idx_migration_logs_migrated_at ON migration_logs(migrated_at);
CREATE INDEX IF NOT EXISTS idx_migration_logs_status ON migration_logs(migration_status);
CREATE INDEX IF NOT EXISTS idx_migration_logs_item_id ON migration_logs(item_id);

-- ===============================
-- SEQUENCE FOR REQUEST NUMBERS
-- ===============================

CREATE SEQUENCE IF NOT EXISTS request_number_seq START 1;

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

-- Update request_steps timestamp
CREATE OR REPLACE FUNCTION update_request_steps_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_request_steps_timestamp_trigger ON request_steps;
CREATE TRIGGER update_request_steps_timestamp_trigger
  BEFORE UPDATE ON request_steps
  FOR EACH ROW
  EXECUTE FUNCTION update_request_steps_timestamp();

-- Cleanup old deprecation logs (keep last 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_deprecation_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM deprecation_logs 
  WHERE logged_at < now() - interval '90 days';
END;
$$ LANGUAGE plpgsql;

-- Cleanup old migration logs (keep last 1 year)
CREATE OR REPLACE FUNCTION cleanup_old_migration_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM migration_logs 
  WHERE migrated_at < now() - interval '1 year';
END;
$$ LANGUAGE plpgsql;

-- Resolve approvers for a given step
CREATE OR REPLACE FUNCTION resolve_step_approvers(
  p_request_id UUID,
  p_step_id UUID
)
RETURNS TABLE(
  user_id UUID,
  full_name TEXT,
  email TEXT,
  department_id UUID
)
LANGUAGE plpgsql
AS $$
DECLARE
  step RECORD;
  request RECORD;
BEGIN
  SELECT * INTO step FROM approval_steps WHERE id = p_step_id;
  SELECT * INTO request FROM approval_requests WHERE id = p_request_id;
  
  IF step IS NULL OR request IS NULL THEN
    RETURN;
  END IF;
  
  CASE step.actor_type
    WHEN 'ROLE' THEN
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE r.name = step.actor_value
      AND p.is_active = true
      AND (p.department_id = request.department_id OR p.department_id IS NULL);
      
    WHEN 'USER_MANAGER' THEN
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      JOIN user_managers um ON p.id = um.manager_id
      WHERE um.user_id = request.initiator_id
      AND um.is_active = true
      AND p.is_active = true;
      
    WHEN 'DEPARTMENT_MANAGER' THEN
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      JOIN department_managers dm ON p.id = dm.user_id
      WHERE dm.department_id = request.department_id
      AND dm.is_active = true
      AND p.is_active = true;
      
    WHEN 'SPECIFIC_USER' THEN
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      WHERE p.id = step.actor_value::UUID
      AND p.is_active = true;
  END CASE;
END;
$$;

-- Migrate approval chains to new structure
CREATE OR REPLACE FUNCTION migrate_approval_chains()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  chain RECORD;
  step_data JSONB;
  step_index INTEGER;
  step_record JSONB;
BEGIN
  FOR chain IN SELECT id, steps FROM approval_chains WHERE jsonb_array_length(steps) > 0 LOOP
    FOR step_index IN 0..jsonb_array_length(chain.steps)-1 LOOP
      step_data := chain.steps -> step_index;
      
      INSERT INTO approval_steps (
        chain_id,
        step_order,
        name,
        description,
        actor_type,
        actor_value,
        action_label,
        due_days
      ) VALUES (
        chain.id,
        step_index + 1,
        COALESCE((step_data->>'name'), 'Step ' || (step_index + 1)),
        step_data->>'description',
        COALESCE(
          CASE 
            WHEN step_data->>'type' = 'user' THEN 'SPECIFIC_USER'
            WHEN step_data->>'type' = 'role' THEN 'ROLE'
            ELSE 'ROLE'
          END,
          'ROLE'
        ),
        CASE 
          WHEN step_data->>'type' = 'user' THEN step_data->>'id'
          ELSE step_data->>'role'
        END,
        COALESCE(step_data->>'action_label', 'Approve'),
        COALESCE((step_data->>'due_days')::INTEGER, 3)
      )
      ON CONFLICT (chain_id, step_order) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

-- Migrate approval actions to request steps
CREATE OR REPLACE FUNCTION migrate_approval_actions()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  action RECORD;
  matching_step RECORD;
BEGIN
  FOR action IN 
    SELECT aa.*, ar.approval_chain_id 
    FROM approval_actions aa
    JOIN approval_requests ar ON aa.request_id = ar.id
    WHERE NOT EXISTS (
      SELECT 1 FROM request_steps rs WHERE rs.request_id = aa.request_id AND rs.step_order = aa.step_order
    )
  LOOP
    SELECT * INTO matching_step 
    FROM approval_steps 
    WHERE chain_id = action.approval_chain_id AND step_order = action.step_order;
    
    IF matching_step IS NOT NULL THEN
      INSERT INTO request_steps (
        request_id,
        step_id,
        step_order,
        name,
        description,
        actor_type,
        actor_value,
        action_label,
        status,
        assigned_to,
        acted_by,
        remarks,
        completed_at,
        created_at
      ) VALUES (
        action.request_id,
        matching_step.id,
        action.step_order,
        matching_step.name,
        matching_step.description,
        matching_step.actor_type,
        matching_step.actor_value,
        matching_step.action_label,
        action.status,
        NULL,
        action.acted_by,
        action.comment,
        action.acted_at,
        action.created_at
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

-- ===============================
-- OPTIONAL: BACKFILL AND REPAIR FUNCTIONS
-- ===============================

-- Function to validate JSON step structure
CREATE OR REPLACE FUNCTION validate_step_structure(step_data JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  IF step_data IS NULL THEN
    RETURN FALSE;
  END IF;
  
  IF step_data->>'roleName' IS NULL 
     AND step_data->>'type' IS NULL 
     AND step_data->>'name' IS NULL THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$;

-- Enhanced migration function with validation and logging
CREATE OR REPLACE FUNCTION migrate_json_steps_to_approval_steps_safe()
RETURNS TABLE(
  chain_id UUID,
  steps_migrated INTEGER,
  steps_failed INTEGER,
  migration_log TEXT[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  chain RECORD;
  step_data JSONB;
  step_index INTEGER;
  step_record JSONB;
  role_id UUID;
  user_id UUID;
  migration_log_entry TEXT[];
  steps_migrated_count INTEGER := 0;
  steps_failed_count INTEGER := 0;
BEGIN
  FOR chain IN SELECT id, steps FROM approval_chains WHERE jsonb_array_length(steps) > 0 LOOP
    steps_migrated_count := 0;
    steps_failed_count := 0;
    migration_log_entry := ARRAY[]::TEXT[];
    
    FOR step_index IN 0..jsonb_array_length(chain.steps)-1 LOOP
      step_data = chain.steps -> step_index;
      
      IF NOT validate_step_structure(step_data) THEN
        steps_failed_count := steps_failed_count + 1;
        migration_log_entry := array_append(migration_log_entry, 
          'Step ' || (step_index + 1) || ': Invalid structure - skipped');
        CONTINUE;
      END IF;
      
      IF step_data->>'roleName' IS NOT NULL THEN
        SELECT id INTO role_id FROM roles WHERE name = step_data->>'roleName';
      END IF;
      
      IF step_data->>'type' = 'user' AND step_data->>'userEmail' IS NOT NULL THEN
        SELECT u.id INTO user_id 
        FROM users u 
        WHERE u.email = step_data->>'userEmail';
        
        IF user_id IS NULL AND step_data->>'userName' IS NOT NULL THEN
          SELECT u.id INTO user_id 
          FROM users u 
          JOIN profiles p ON u.id = p.id
          WHERE p.full_name = step_data->>'userName';
        END IF;
      END IF;
      
      BEGIN
        INSERT INTO approval_steps (
          chain_id,
          step_order,
          name,
          description,
          actor_type,
          actor_value,
          role_id,
          user_id,
          action_label,
          due_days
        ) VALUES (
          chain.id,
          COALESCE(
            CASE 
              WHEN (step_data->>'order') ~ '^[0-9]+$' THEN (step_data->>'order')::INTEGER
              ELSE step_index + 1
            END,
            step_index + 1
          ),
          COALESCE(step_data->>'name', 'Step ' || (step_index + 1)),
          step_data->>'description',
          CASE 
            WHEN step_data->>'type' = 'user' THEN 'SPECIFIC_USER'
            WHEN step_data->>'type' = 'manager' THEN 'USER_MANAGER'
            WHEN step_data->>'type' = 'department_manager' THEN 'DEPARTMENT_MANAGER'
            WHEN step_data->>'roleName' IS NOT NULL THEN 'ROLE'
            ELSE 'ROLE'
          END,
          CASE 
            WHEN step_data->>'type' = 'user' THEN user_id::TEXT
            WHEN step_data->>'type' IN ('manager', 'department_manager') THEN NULL
            WHEN step_data->>'roleName' IS NOT NULL THEN step_data->>'roleName'
            ELSE 'Unknown'
          END,
          role_id,
          user_id,
          COALESCE(step_data->>'action', 'Review'),
          COALESCE((step_data->>'due_days')::INTEGER, 3)
        );
        
        steps_migrated_count := steps_migrated_count + 1;
        migration_log_entry := array_append(migration_log_entry, 
          'Step ' || (step_index + 1) || ': Migrated successfully');
          
      EXCEPTION WHEN OTHERS THEN
        steps_failed_count := steps_failed_count + 1;
        migration_log_entry := array_append(migration_log_entry, 
          'Step ' || (step_index + 1) || ': Failed - ' || SQLERRM);
      END;
    END LOOP;
    
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Function to verify migration completeness
CREATE OR REPLACE FUNCTION verify_migration_completeness()
RETURNS TABLE(
  check_name TEXT,
  expected_count BIGINT,
  actual_count BIGINT,
  status TEXT,
  details TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  total_chains BIGINT;
  chains_with_json_steps BIGINT;
  chains_with_table_steps BIGINT;
  total_json_steps BIGINT;
  total_table_steps BIGINT;
BEGIN
  SELECT COUNT(*) INTO total_chains FROM approval_chains;
  SELECT COUNT(*) INTO chains_with_json_steps FROM approval_chains WHERE jsonb_array_length(steps) > 0;
  SELECT COUNT(DISTINCT chain_id) INTO chains_with_table_steps FROM approval_steps;
  
  RETURN QUERY
  SELECT 'Chain step migration'::TEXT, 
         chains_with_json_steps, 
         chains_with_table_steps, 
         CASE WHEN chains_with_json_steps = chains_with_table_steps THEN 'PASS' ELSE 'FAIL' END,
         'Chains with JSON steps vs chains with table steps';
  
  SELECT COALESCE(SUM(jsonb_array_length(steps)), 0) INTO total_json_steps 
  FROM approval_chains;
  
  SELECT COUNT(*) INTO total_table_steps FROM approval_steps;
  
  RETURN QUERY
  SELECT 'Step count migration'::TEXT,
         total_json_steps,
         total_table_steps,
         CASE WHEN total_json_steps = total_table_steps THEN 'PASS' ELSE 'FAIL' END,
         'Total JSON steps vs total table steps';
  
  RETURN QUERY
  SELECT 'Actor type validation'::TEXT,
         total_table_steps,
         (SELECT COUNT(*) FROM approval_steps WHERE actor_type IN ('ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER')),
         CASE WHEN (SELECT COUNT(*) FROM approval_steps WHERE actor_type IN ('ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER')) = total_table_steps THEN 'PASS' ELSE 'FAIL' END,
         'All steps have valid actor_type';
  
  RETURN QUERY
  SELECT 'Department manager population'::TEXT,
         (SELECT COUNT(*) FROM departments WHERE head_name IS NOT NULL),
         (SELECT COUNT(*) FROM departments WHERE manager_user_id IS NOT NULL),
         'INFO'::TEXT,
         'Departments with head_name vs departments with manager_user_id';
  
  RETURN QUERY
  SELECT 'User department sync'::TEXT,
         (SELECT COUNT(*) FROM profiles WHERE department_id IS NOT NULL),
         (SELECT COUNT(*) FROM users WHERE department_id IS NOT NULL),
         'INFO'::TEXT,
         'Profiles with department vs users with department';
END;
$$;

-- Function to repair missing actor_value for ROLE type
CREATE OR REPLACE FUNCTION repair_role_actor_values()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  repair_count INTEGER := 0;
BEGIN
  UPDATE approval_steps 
  SET actor_value = r.name
  FROM roles r
  WHERE approval_steps.actor_type = 'ROLE' 
  AND approval_steps.actor_value IS NULL 
  AND approval_steps.role_id = r.id;
  
  GET DIAGNOSTICS repair_count = ROW_COUNT;
  
  RETURN repair_count;
END;
$$;

-- Function to repair missing actor_value for SPECIFIC_USER type
CREATE OR REPLACE FUNCTION repair_specific_user_actor_values()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  repair_count INTEGER := 0;
BEGIN
  UPDATE approval_steps 
  SET actor_value = user_id::TEXT
  WHERE actor_type = 'SPECIFIC_USER' 
  AND actor_value IS NULL 
  AND user_id IS NOT NULL;
  
  GET DIAGNOSTICS repair_count = ROW_COUNT;
  
  RETURN repair_count;
END;
$$;

-- ===============================
-- VIEWS FOR STATISTICS AND MONITORING
-- ===============================

CREATE OR REPLACE VIEW deprecation_stats AS
SELECT 
  component,
  DATE_TRUNC('day', logged_at) as log_date,
  COUNT(*) as warning_count,
  COUNT(DISTINCT step_name || '|' || step_order) as unique_steps,
  COUNT(DISTINCT request_id) as unique_requests,
  array_agg(DISTINCT warning_message) as warning_types
FROM deprecation_logs 
WHERE logged_at >= now() - interval '30 days'
GROUP BY component, DATE_TRUNC('day', logged_at)
ORDER BY log_date DESC;

CREATE OR REPLACE VIEW migration_progress AS
SELECT 
  component,
  migration_status,
  COUNT(*) as migration_count,
  MIN(migrated_at) as first_migration,
  MAX(migrated_at) as last_migration
FROM migration_logs 
WHERE migrated_at >= now() - interval '30 days'
GROUP BY component, migration_status
ORDER BY component, migration_status;

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

INSERT INTO migration_log (migration_name) 
VALUES 
  ('consolidated-schema-2026-04-13'),
  ('002-dynamic-approver-resolution'),
  ('003-add-actor-columns'),
  ('004-backward-compatibility-logging'),
  ('005-populate-request-steps'),
  ('visibility-scoped-department-managers')
ON CONFLICT (migration_name) DO NOTHING;

-- ===============================
-- VERIFICATION
-- ===============================

DO $$
DECLARE
  base_table_count INTEGER;
  migration_table_count INTEGER;
  index_count INTEGER;
  total_tables INTEGER;
BEGIN
  -- Count base tables
  SELECT COUNT(*) INTO base_table_count
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'users', 'departments', 'roles', 'profiles', 'approval_types', 
    'approval_chains', 'approval_requests', 'approval_actions', 
    'audit_logs', 'company_settings', 'approval_type_attachments', 
    'request_attachments', 'migration_log'
  );
  
  -- Count migration tables
  SELECT COUNT(*) INTO migration_table_count
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
  AND table_name IN (
    'approval_steps', 'request_steps', 'department_managers', 
    'user_managers', 'deprecation_logs', 'migration_logs'
  );
  
  -- Count indexes
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes 
  WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%';
  
  total_tables := base_table_count + migration_table_count;

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '✅ APPROVAL CENTRAL SCHEMA SETUP COMPLETE';
  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE '📊 Base Tables: % / 13', base_table_count;
  RAISE NOTICE '🔄 Migration Tables: % / 6', migration_table_count;
  RAISE NOTICE '📈 Total Tables: %', total_tables;
  RAISE NOTICE '🗂️  Indexes Created: %', index_count;
  RAISE NOTICE '';
  RAISE NOTICE '✨ Features Enabled:';
  RAISE NOTICE '  • Dynamic Approver Resolution';
  RAISE NOTICE '  • Department-Scoped Visibility (NEW)';
  RAISE NOTICE '  • Request Step Tracking';
  RAISE NOTICE '  • User Manager Relationships';
  RAISE NOTICE '  • Backward Compatibility Logging';
  RAISE NOTICE '';
  RAISE NOTICE '🚀 Ready to use! No migrations needed.';
  RAISE NOTICE '════════════════════════════════════════';
END $$;

-- ===============================
-- SCHEMA DOCUMENTATION
-- ===============================

COMMENT ON TABLE department_managers IS 'Maps users to departments they manage. CRITICAL for the new visibility feature that allows department managers to see only their department''s requests.';

COMMENT ON TABLE request_steps IS 'Tracks which users are assigned to which approval steps. Used for the new visibility feature to show requests only to assigned approvers.';

COMMENT ON INDEX idx_request_steps_assigned_to_status IS 'CRITICAL: Used by new visibility feature to quickly find requests assigned to a user at their current step.';

COMMENT ON INDEX idx_department_managers_dept_active IS 'CRITICAL: Used by new visibility feature to find which departments a user manages.';

COMMENT ON VIEW approval_actions_view IS 'Backward compatibility view for existing approval_actions queries. Maps request_steps to legacy approval_actions format.';

COMMENT ON FUNCTION resolve_step_approvers IS 'Dynamically resolves approvers for a given step based on actor type (ROLE, USER_MANAGER, DEPARTMENT_MANAGER, SPECIFIC_USER).';
