-- Approval Central — standalone Postgres schema (no Supabase auth schema)
-- Apply to an empty database: psql $DATABASE_URL -f sql/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES approval_requests(id) ON DELETE CASCADE NOT NULL,
  step_order INTEGER NOT NULL,
  role_name TEXT NOT NULL,
  action_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped', 'changes_requested')),
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_department ON profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_approval_requests_initiator ON approval_requests(initiator_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_type ON approval_requests(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_chain ON approval_requests(approval_chain_id);
CREATE INDEX IF NOT EXISTS idx_approval_actions_request ON approval_actions(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_chains_type ON approval_chains(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

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
  first_non_skipped_found BOOLEAN := FALSE;
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
    -- Otherwise, mark first non-skipped as pending, rest as waiting
    ELSIF NOT first_non_skipped_found THEN
      step_status := 'pending';
      first_non_skipped_found := TRUE;
    ELSE
      step_status := 'waiting';
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

INSERT INTO company_settings (company_name)
SELECT 'ApprovalHub'
WHERE NOT EXISTS (SELECT 1 FROM company_settings LIMIT 1);
