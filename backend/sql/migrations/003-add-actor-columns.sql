-- Migration: Add Actor Type Columns for Dynamic Approver Resolution
-- This migration adds new columns to support USER_MANAGER, DEPARTMENT_MANAGER, and SPECIFIC_USER actor types
-- while maintaining backward compatibility with existing data

-- ===============================
-- STEP 1: Add approval_steps table
-- ===============================

CREATE TABLE IF NOT EXISTS approval_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id UUID NOT NULL REFERENCES approval_chains(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- NEW COLUMNS for dynamic resolution
  actor_type TEXT NOT NULL DEFAULT 'ROLE' CHECK (actor_type IN ('ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER')),
  actor_value TEXT, -- Role name for ROLE, User ID for SPECIFIC_USER, NULL for manager types
  -- EXISTING COLUMNS (marked as deprecated but kept for compatibility)
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL, -- DEPRECATED: Use actor_type='ROLE' and actor_value instead
  user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- DEPRECATED: Use actor_type='SPECIFIC_USER' and actor_value instead
  -- Other existing columns
  action_label TEXT NOT NULL DEFAULT 'Review',
  due_days INTEGER DEFAULT 3,
  is_parallel BOOLEAN DEFAULT false,
  parallel_group TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chain_id, step_order)
);

-- ===============================
-- STEP 2: Add manager relationships to users table
-- ===============================

ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

-- ===============================
-- STEP 3: Add manager_user_id to departments table
-- ===============================

ALTER TABLE departments ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ===============================
-- STEP 4: Add indexes for performance
-- ===============================

CREATE INDEX IF NOT EXISTS idx_approval_steps_chain_order ON approval_steps(chain_id, step_order);
CREATE INDEX IF NOT EXISTS idx_approval_steps_actor_type ON approval_steps(actor_type);
CREATE INDEX IF NOT EXISTS idx_approval_steps_actor_value ON approval_steps(actor_value) WHERE actor_value IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id) WHERE manager_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_departments_manager_user_id ON departments(manager_user_id) WHERE manager_user_id IS NOT NULL;

-- ===============================
-- STEP 5: Create trigger to populate users.department_id from profiles
-- ===============================

CREATE OR REPLACE FUNCTION sync_user_department()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Sync department_id from profiles to users table
  UPDATE users 
  SET department_id = NEW.department_id
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS sync_user_department_trigger ON profiles;
CREATE TRIGGER sync_user_department_trigger
  AFTER INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_department();

-- ===============================
-- STEP 6: Backfill existing data
-- ===============================

-- Create function to migrate JSON steps to approval_steps table
CREATE OR REPLACE FUNCTION migrate_json_steps_to_approval_steps()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  chain RECORD;
  step_data JSONB;
  step_index INTEGER;
  step_record JSONB;
  role_id UUID;
  user_id UUID;
BEGIN
  -- Process each approval chain
  FOR chain IN SELECT id, steps FROM approval_chains WHERE jsonb_array_length(steps) > 0 LOOP
    -- Parse steps JSON and create approval_steps records
    FOR step_index IN 0..jsonb_array_length(chain.steps)-1 LOOP
      step_data = chain.steps -> step_index;
      
      -- Try to find role_id for roleName (for backward compatibility)
      SELECT id INTO role_id FROM roles WHERE name = step_data->>'roleName';
      
      -- Try to find user_id if this is a user-specific step
      SELECT id INTO user_id FROM users WHERE email = step_data->>'userEmail';
      
      -- Determine actor_type and actor_value
      INSERT INTO approval_steps (
        chain_id,
        step_order,
        name,
        description,
        actor_type,
        actor_value,
        role_id, -- DEPRECATED but filled for compatibility
        user_id, -- DEPRECATED but filled for compatibility
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
          ELSE 'ROLE'
        END,
        CASE 
          WHEN step_data->>'type' = 'user' THEN user_id::TEXT
          WHEN step_data->>'type' IN ('manager', 'department_manager') THEN NULL
          ELSE step_data->>'roleName'
        END,
        role_id, -- DEPRECATED
        user_id, -- DEPRECATED
        COALESCE(step_data->>'action', 'Review'),
        COALESCE((step_data->>'due_days')::INTEGER, 3)
      );
    END LOOP;
  END LOOP;
END;
$$;

-- Create function to backfill manager relationships
CREATE OR REPLACE FUNCTION backfill_manager_relationships()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  dept RECORD;
  manager_record RECORD;
BEGIN
  -- Backfill department managers from head_name (best effort)
  FOR dept IN SELECT id, head_name FROM departments WHERE head_name IS NOT NULL LOOP
    -- Try to find user by full_name matching head_name
    SELECT id INTO manager_record FROM profiles WHERE full_name = dept.head_name LIMIT 1;
    
    IF manager_record.id IS NOT NULL THEN
      UPDATE departments 
      SET manager_user_id = manager_record.id 
      WHERE id = dept.id;
    END IF;
  END LOOP;
  
  -- Backfill user department_id from profiles
  UPDATE users 
  SET department_id = p.department_id
  FROM profiles p
  WHERE users.id = p.id AND p.department_id IS NOT NULL;
END;
$$;

-- ===============================
-- STEP 7: Create views for backward compatibility
-- ===============================

-- Create view that mimics the old JSON structure
CREATE OR REPLACE VIEW approval_chains_with_steps AS
SELECT 
  ac.*,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'order', as_.step_order,
        'name', as_.name,
        'description', as_.description,
        'roleName', CASE 
          WHEN as_.actor_type = 'ROLE' THEN as_.actor_value
          WHEN as_.actor_type = 'DEPARTMENT_MANAGER' THEN 'Department Manager'
          WHEN as_.actor_type = 'USER_MANAGER' THEN 'User Manager'
          ELSE as_.actor_value
        END,
        'action', as_.action_label,
        'due_days', as_.due_days,
        'type', CASE 
          WHEN as_.actor_type = 'SPECIFIC_USER' THEN 'user'
          WHEN as_.actor_type = 'DEPARTMENT_MANAGER' THEN 'department_manager'
          WHEN as_.actor_type = 'USER_MANAGER' THEN 'manager'
          ELSE 'role'
        END,
        'roleId', as_.role_id, -- DEPRECATED
        'userId', as_.user_id   -- DEPRECATED
      ) ORDER BY as_.step_order
    ),
    '[]'::jsonb
  ) as steps
FROM approval_chains ac
LEFT JOIN approval_steps as_ ON ac.id = as_.chain_id
GROUP BY ac.id, ac.name, ac.approval_type_id, ac.steps, ac.created_by, ac.created_at, ac.updated_at;

-- ===============================
-- STEP 8: Update existing trigger to use new approval_steps table
-- ===============================

CREATE OR REPLACE FUNCTION create_approval_actions_for_request_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  step_record RECORD;
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

  -- Use the new approval_steps table instead of JSON
  FOR step_record IN 
    SELECT * FROM approval_steps 
    WHERE chain_id = NEW.approval_chain_id 
    ORDER BY step_order
  LOOP
    -- Determine step status
    -- If the step's role matches the initiator's role, skip it
    IF step_record.actor_type = 'ROLE' AND 
       COALESCE(step_record.actor_value, '') = COALESCE(initiator_role_name, '') THEN
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
      step_record.step_order,
      CASE 
        WHEN step_record.actor_type = 'ROLE' THEN step_record.actor_value
        WHEN step_record.actor_type = 'DEPARTMENT_MANAGER' THEN 'Department Manager'
        WHEN step_record.actor_type = 'USER_MANAGER' THEN 'User Manager'
        ELSE step_record.actor_value
      END,
      step_record.action_label,
      step_status
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- Replace the old trigger (but keep it for backup)
DROP TRIGGER IF EXISTS trg_create_approval_actions ON approval_requests;
CREATE TRIGGER trg_create_approval_actions
  AFTER INSERT ON approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION create_approval_actions_for_request_v2();

-- ===============================
-- STEP 9: Log migration completion
-- ===============================

INSERT INTO migration_log (migration_name) 
VALUES ('003-add-actor-columns') 
ON CONFLICT (migration_name) DO NOTHING;

-- ===============================
-- NOTES
-- ===============================

-- This migration:
-- 1. Creates approval_steps table with new actor_type/actor_value columns
-- 2. Adds manager relationships to users and departments tables
-- 3. Migrates existing JSON steps to the new table structure
-- 4. Maintains backward compatibility through views and deprecated columns
-- 5. Updates triggers to use the new structure

-- To run the data migration:
-- SELECT migrate_json_steps_to_approval_steps();
-- SELECT backfill_manager_relationships();

-- Existing APIs will continue to work through the approval_chains_with_steps view
-- and the deprecated columns in approval_steps table.
