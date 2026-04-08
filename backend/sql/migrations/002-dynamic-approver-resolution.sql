-- Migration: Dynamic Approver Resolution
-- This migration adds support for dynamic approver resolution while maintaining backward compatibility

-- ===============================
-- NEW TABLES FOR DYNAMIC RESOLUTION
-- ===============================

-- Approval steps definition (replaces JSON in approval_chains)
CREATE TABLE IF NOT EXISTS approval_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id UUID NOT NULL REFERENCES approval_chains(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER')),
  actor_value TEXT, -- Role name for ROLE, User ID for SPECIFIC_USER, NULL for manager types
  action_label TEXT NOT NULL DEFAULT 'Approve',
  due_days INTEGER DEFAULT 3,
  is_parallel BOOLEAN DEFAULT false,
  parallel_group TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chain_id, step_order)
);

-- Request steps (replaces approval_actions for better tracking)
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Department manager assignments (for department-scoped approvals)
CREATE TABLE IF NOT EXISTS department_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES profiles(id),
  UNIQUE(department_id, user_id)
);

-- User manager relationships (for USER_MANAGER resolution)
CREATE TABLE IF NOT EXISTS user_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  manager_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES profiles(id),
  UNIQUE(user_id, manager_id)
);

-- ===============================
-- BACKWARD COMPATIBILITY VIEWS
-- ===============================

-- View to maintain compatibility with existing approval_actions queries
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
-- MIGRATION LOGIC
-- ===============================

-- Function to migrate existing approval chains to new structure
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
  -- Migrate each approval chain
  FOR chain IN SELECT id, steps FROM approval_chains WHERE jsonb_array_length(steps) > 0 LOOP
    -- Parse steps JSON and create approval_steps records
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
      );
    END LOOP;
  END LOOP;
END;
$$;

-- Function to migrate existing approval actions to request steps
CREATE OR REPLACE FUNCTION migrate_approval_actions()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  action RECORD;
  matching_step RECORD;
BEGIN
  -- Migrate each approval action
  FOR action IN 
    SELECT aa.*, ar.approval_chain_id 
    FROM approval_actions aa
    JOIN approval_requests ar ON aa.request_id = ar.id
    WHERE NOT EXISTS (
      SELECT 1 FROM request_steps rs WHERE rs.request_id = aa.request_id AND rs.step_order = aa.step_order
    )
  LOOP
    -- Find matching approval step
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
        NULL, -- assigned_to - will be resolved dynamically
        action.acted_by,
        action.comment,
        action.acted_at,
        action.created_at
      );
    END IF;
  END LOOP;
END;
$$;

-- ===============================
-- INDEXES FOR PERFORMANCE
-- ===============================

CREATE INDEX IF NOT EXISTS idx_approval_steps_chain_order ON approval_steps(chain_id, step_order);
CREATE INDEX IF NOT EXISTS idx_request_steps_request_order ON request_steps(request_id, step_order);
CREATE INDEX IF NOT EXISTS idx_request_steps_status ON request_steps(status) WHERE status IN ('PENDING', 'WAITING');
CREATE INDEX IF NOT EXISTS idx_request_steps_assigned_to ON request_steps(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_department_managers_dept_active ON department_managers(department_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_managers_user_active ON user_managers(user_id, is_active) WHERE is_active = true;

-- ===============================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ===============================

-- Update request_steps updated_at timestamp
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

-- ===============================
-- HELPER FUNCTIONS FOR DYNAMIC RESOLUTION
-- ===============================

-- Function to resolve approvers for a given step
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
  approvers RECORD[];
BEGIN
  -- Get step and request details
  SELECT * INTO step FROM approval_steps WHERE id = p_step_id;
  SELECT * INTO request FROM approval_requests WHERE id = p_request_id;
  
  IF step IS NULL OR request IS NULL THEN
    RETURN;
  END IF;
  
  -- Resolve approvers based on actor type
  CASE step.actor_type
    WHEN 'ROLE' THEN
      -- Find users with the specified role
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE r.name = step.actor_value
      AND p.is_active = true
      AND (p.department_id = request.department_id OR p.department_id IS NULL);
      
    WHEN 'USER_MANAGER' THEN
      -- Find the user's manager
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      JOIN user_managers um ON p.id = um.manager_id
      WHERE um.user_id = request.initiator_id
      AND um.is_active = true
      AND p.is_active = true;
      
    WHEN 'DEPARTMENT_MANAGER' THEN
      -- Find the department manager
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      JOIN department_managers dm ON p.id = dm.user_id
      WHERE dm.department_id = request.department_id
      AND dm.is_active = true
      AND p.is_active = true;
      
    WHEN 'SPECIFIC_USER' THEN
      -- Return the specific user
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      WHERE p.id = step.actor_value::UUID
      AND p.is_active = true;
  END CASE;
END;
$$;

-- ===============================
-- RUN MIGRATION (COMMENTED OUT - RUN MANUALLY)
-- ===============================

-- Uncomment the following lines to run the migration:
-- SELECT migrate_approval_chains();
-- SELECT migrate_approval_actions();

-- ===============================
-- NOTES
-- ===============================

-- This migration provides:
-- 1. Dynamic approver resolution based on request context
-- 2. Department-scoped approvals
-- 3. Backward compatibility through views
-- 4. Support for change request resumption
-- 5. Better audit trail with request_steps

-- Existing APIs will continue to work through the approval_actions_view
-- New APIs should use the dynamic resolution functions
