-- Rollback Script: Remove Actor Type Columns
-- This script reverses the changes made by 003-add-actor-columns.sql
-- WARNING: This will remove the new approval_steps table and all migrated data

-- ===============================
-- STEP 1: Remove new triggers and functions
-- ===============================

-- Restore original trigger
DROP TRIGGER IF EXISTS trg_create_approval_actions ON approval_requests;

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

CREATE TRIGGER trg_create_approval_actions
  AFTER INSERT ON approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION create_approval_actions_for_request();

-- Drop new functions
DROP FUNCTION IF EXISTS create_approval_actions_for_request_v2();
DROP FUNCTION IF EXISTS migrate_json_steps_to_approval_steps();
DROP FUNCTION IF EXISTS backfill_manager_relationships();
DROP FUNCTION IF EXISTS sync_user_department();

-- ===============================
-- STEP 2: Remove views
-- ===============================

DROP VIEW IF EXISTS approval_chains_with_steps;

-- ===============================
-- STEP 3: Remove approval_steps table
-- ===============================

-- WARNING: This will delete all migrated step data!
DROP TABLE IF EXISTS approval_steps CASCADE;

-- ===============================
-- STEP 4: Remove new columns from users table
-- ===============================

ALTER TABLE users DROP COLUMN IF EXISTS manager_id;
ALTER TABLE users DROP COLUMN IF EXISTS department_id;

-- ===============================
-- STEP 5: Remove new column from departments table
-- ===============================

ALTER TABLE departments DROP COLUMN IF EXISTS manager_user_id;

-- ===============================
-- STEP 6: Remove triggers
-- ===============================

DROP TRIGGER IF EXISTS sync_user_department_trigger ON profiles;

-- ===============================
-- STEP 7: Remove migration log entry
-- ===============================

DELETE FROM migration_log WHERE migration_name = '003-add-actor-columns';

-- ===============================
-- STEP 8: Verification queries (optional)
-- ===============================

-- Verify old structure is restored
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' AND table_name LIKE '%approval%';

-- Verify users table structure
-- \d users

-- Verify departments table structure  
-- \d departments

-- ===============================
-- NOTES
-- ===============================

-- This rollback script:
-- 1. Restores the original trigger that uses JSON steps
-- 2. Removes the new approval_steps table and all migrated data
-- 3. Removes manager relationship columns from users and departments
-- 4. Removes compatibility views and new functions
-- 5. Cleans up migration logs

-- WARNING: All data migrated to approval_steps table will be lost!
-- The original approval_chains.steps JSON data should still exist
-- unless it was modified after migration.

-- After rollback, the system will function exactly as it did before
-- the migration, using JSON-based step definitions.
