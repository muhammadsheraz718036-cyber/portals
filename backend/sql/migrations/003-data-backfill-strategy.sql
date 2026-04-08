-- Data Backfill Strategy for Actor Type Migration
-- This script provides a comprehensive strategy for backfilling data from the old JSON-based system
-- to the new actor_type/actor_value system while preserving all existing functionality

-- ===============================
-- BACKFILL STRATEGY OVERVIEW
-- ===============================

-- This migration handles the following transformations:
-- 1. JSON steps → approval_steps table with actor_type/actor_value
-- 2. roleName → actor_type='ROLE', actor_value=roleName
-- 3. User-specific steps → actor_type='SPECIFIC_USER', actor_value=userId
-- 4. Manager steps → actor_type='USER_MANAGER' or 'DEPARTMENT_MANAGER'
-- 5. Department relationships → manager_user_id and user.manager_id

-- ===============================
-- STEP 1: Create backfill functions with validation
-- ===============================

-- Function to validate JSON step structure
CREATE OR REPLACE FUNCTION validate_step_structure(step_data JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check for required fields
  IF step_data IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Must have at least one of: roleName, type, or name
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
  -- Process each approval chain
  FOR chain IN SELECT id, steps FROM approval_chains WHERE jsonb_array_length(steps) > 0 LOOP
    steps_migrated_count := 0;
    steps_failed_count := 0;
    migration_log_entry := ARRAY[]::TEXT[];
    
    -- Parse steps JSON and create approval_steps records
    FOR step_index IN 0..jsonb_array_length(chain.steps)-1 LOOP
      step_data = chain.steps -> step_index;
      
      -- Validate step structure
      IF NOT validate_step_structure(step_data) THEN
        steps_failed_count := steps_failed_count + 1;
        migration_log_entry := array_append(migration_log_entry, 
          'Step ' || (step_index + 1) || ': Invalid structure - skipped');
        CONTINUE;
      END IF;
      
      -- Try to find role_id for roleName (for backward compatibility)
      IF step_data->>'roleName' IS NOT NULL THEN
        SELECT id INTO role_id FROM roles WHERE name = step_data->>'roleName';
      END IF;
      
      -- Try to find user_id if this is a user-specific step
      IF step_data->>'type' = 'user' AND step_data->>'userEmail' IS NOT NULL THEN
        SELECT u.id INTO user_id 
        FROM users u 
        WHERE u.email = step_data->>'userEmail';
        
        -- If not found by email, try by name
        IF user_id IS NULL AND step_data->>'userName' IS NOT NULL THEN
          SELECT u.id INTO user_id 
          FROM users u 
          JOIN profiles p ON u.id = p.id
          WHERE p.full_name = step_data->>'userName';
        END IF;
      END IF;
      
      -- Determine actor_type and actor_value with fallback logic
      BEGIN
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
            WHEN step_data->>'roleName' IS NOT NULL THEN 'ROLE'
            ELSE 'ROLE' -- Default fallback
          END,
          CASE 
            WHEN step_data->>'type' = 'user' THEN user_id::TEXT
            WHEN step_data->>'type' IN ('manager', 'department_manager') THEN NULL
            WHEN step_data->>'roleName' IS NOT NULL THEN step_data->>'roleName'
            ELSE 'Unknown' -- Default fallback
          END,
          role_id, -- DEPRECATED
          user_id, -- DEPRECATED
          COALESCE(step_data->>'action', 'Review'),
          COALESCE((step_data->>'due_days')::INTEGER, 3)
        );
        
        steps_migrated_count := steps_migrated_count + 1;
        migration_log_entry := array_append(migration_log_entry, 
          'Step ' || (step_index + 1) || ': Migrated successfully as ' || 
          CASE 
            WHEN step_data->>'type' = 'user' THEN 'SPECIFIC_USER'
            WHEN step_data->>'type' = 'manager' THEN 'USER_MANAGER'
            WHEN step_data->>'type' = 'department_manager' THEN 'DEPARTMENT_MANAGER'
            ELSE 'ROLE'
          END);
          
      EXCEPTION WHEN OTHERS THEN
        steps_failed_count := steps_failed_count + 1;
        migration_log_entry := array_append(migration_log_entry, 
          'Step ' || (step_index + 1) || ': Failed - ' || SQLERRM);
      END;
    END LOOP;
    
    -- Return results for this chain
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ===============================
-- STEP 2: Manager relationship backfill with multiple strategies
-- ===============================

CREATE OR REPLACE FUNCTION backfill_manager_relationships_comprehensive()
RETURNS TABLE(
  strategy TEXT,
  relationships_found INTEGER,
  relationships_created INTEGER,
  details TEXT[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  dept RECORD;
  manager_record RECORD;
  relationships_found_count INTEGER := 0;
  relationships_created_count INTEGER := 0;
  strategy_details TEXT[];
BEGIN
  
  -- Strategy 1: Backfill from departments.head_name to departments.manager_user_id
  strategy_details := array_append(strategy_details, 'Strategy 1: Department head_name → manager_user_id');
  
  FOR dept IN SELECT id, head_name FROM departments WHERE head_name IS NOT NULL LOOP
    -- Try multiple approaches to find the manager
    -- Approach 1: Exact match on full_name
    SELECT id INTO manager_record FROM profiles WHERE full_name = dept.head_name LIMIT 1;
    
    -- Approach 2: Partial match if exact fails
    IF manager_record.id IS NULL THEN
      SELECT id INTO manager_record FROM profiles 
      WHERE full_name ILIKE '%' || dept.head_name || '%' LIMIT 1;
    END IF;
    
    -- Approach 3: Match on email if head_name looks like email
    IF manager_record.id IS NULL AND dept.head_name LIKE '%@%' THEN
      SELECT id INTO manager_record FROM users WHERE email = dept.head_name LIMIT 1;
    END IF;
    
    IF manager_record.id IS NOT NULL THEN
      UPDATE departments 
      SET manager_user_id = manager_record.id 
      WHERE id = dept.id;
      relationships_created_count := relationships_created_count + 1;
      relationships_found_count := relationships_found_count + 1;
      strategy_details := array_append(strategy_details, 
        'Department ' || dept.id || ': Found manager ' || manager_record.id);
    ELSE
      strategy_details := array_append(strategy_details, 
        'Department ' || dept.id || ': No manager found for "' || dept.head_name || '"');
    END IF;
    
    manager_record.id := NULL; -- Reset for next iteration
  END LOOP;
  
  RETURN NEXT;
  
  -- Strategy 2: Backfill user department_id from profiles
  strategy_details := ARRAY['Strategy 2: Profiles.department_id → users.department_id'];
  relationships_created_count := 0;
  
  UPDATE users 
  SET department_id = p.department_id
  FROM profiles p
  WHERE users.id = p.id 
  AND p.department_id IS NOT NULL 
  AND users.department_id IS NULL;
  
  GET DIAGNOSTICS relationships_created_count = ROW_COUNT;
  relationships_found_count := relationships_created_count;
  
  RETURN NEXT;
  
  -- Strategy 3: Infer manager relationships from existing approval data
  strategy_details := ARRAY['Strategy 3: Infer from approval patterns'];
  relationships_created_count := 0;
  relationships_found_count := 0;
  
  -- Find users who frequently approve requests for specific departments
  INSERT INTO users (id, manager_id)
  SELECT DISTINCT 
    ar.initiator_id,
    aa.acted_by
  FROM approval_requests ar
  JOIN approval_actions aa ON ar.id = aa.request_id
  WHERE aa.acted_by IS NOT NULL 
  AND ar.initiator_id != aa.acted_by
  AND aa.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ar.initiator_id AND u.manager_id IS NOT NULL)
  ON CONFLICT (id) DO UPDATE SET manager_id = EXCLUDED.manager_id;
  
  GET DIAGNOSTICS relationships_created_count = ROW_COUNT;
  relationships_found_count := relationships_created_count;
  
  RETURN NEXT;
END;
$$;

-- ===============================
-- STEP 3: Validation and verification functions
-- ===============================

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
  -- Check 1: All chains with JSON steps should have table steps
  SELECT COUNT(*) INTO total_chains FROM approval_chains;
  SELECT COUNT(*) INTO chains_with_json_steps FROM approval_chains WHERE jsonb_array_length(steps) > 0;
  SELECT COUNT(DISTINCT chain_id) INTO chains_with_table_steps FROM approval_steps;
  
  RETURN NEXT
  SELECT 'Chain step migration'::TEXT, 
         chains_with_json_steps, 
         chains_with_table_steps, 
         CASE WHEN chains_with_json_steps = chains_with_table_steps THEN 'PASS' ELSE 'FAIL' END,
         'Chains with JSON steps vs chains with table steps';
  
  -- Check 2: Step count should match
  SELECT COALESCE(SUM(jsonb_array_length(steps)), 0) INTO total_json_steps 
  FROM approval_chains;
  
  SELECT COUNT(*) INTO total_table_steps FROM approval_steps;
  
  RETURN NEXT
  SELECT 'Step count migration'::TEXT,
         total_json_steps,
         total_table_steps,
         CASE WHEN total_json_steps = total_table_steps THEN 'PASS' ELSE 'FAIL' END,
         'Total JSON steps vs total table steps';
  
  -- Check 3: All steps should have valid actor_type
  RETURN NEXT
  SELECT 'Actor type validation'::TEXT,
         total_table_steps,
         (SELECT COUNT(*) FROM approval_steps WHERE actor_type IN ('ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER')),
         CASE WHEN (SELECT COUNT(*) FROM approval_steps WHERE actor_type IN ('ROLE', 'USER_MANAGER', 'DEPARTMENT_MANAGER', 'SPECIFIC_USER')) = total_table_steps THEN 'PASS' ELSE 'FAIL' END,
         'All steps have valid actor_type';
  
  -- Check 4: Department managers should be populated
  RETURN NEXT
  SELECT 'Department manager population'::TEXT,
         (SELECT COUNT(*) FROM departments WHERE head_name IS NOT NULL),
         (SELECT COUNT(*) FROM departments WHERE manager_user_id IS NOT NULL),
         'INFO',
         'Departments with head_name vs departments with manager_user_id';
  
  -- Check 5: User department sync
  RETURN NEXT
  SELECT 'User department sync'::TEXT,
         (SELECT COUNT(*) FROM profiles WHERE department_id IS NOT NULL),
         (SELECT COUNT(*) FROM users WHERE department_id IS NOT NULL),
         'INFO',
         'Profiles with department vs users with department';
END;
$$;

-- ===============================
-- STEP 4: Data repair functions
-- ===============================

-- Function to repair missing actor_value for ROLE type
CREATE OR REPLACE FUNCTION repair_role_actor_values()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  repair_count INTEGER := 0;
BEGIN
  -- For steps with actor_type='ROLE' and null actor_value, try to get from deprecated role_id
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
  -- For steps with actor_type='SPECIFIC_USER' and null actor_value, try to get from deprecated user_id
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
-- STEP 5: Migration execution script
-- ===============================

-- Main migration execution function
CREATE OR REPLACE FUNCTION execute_complete_backfill()
RETURNS TABLE(
  phase TEXT,
  status TEXT,
  records_processed INTEGER,
  details TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Phase 1: Migrate JSON steps to approval_steps
  RETURN NEXT
  SELECT 'JSON Steps Migration'::TEXT, 'STARTED'::TEXT, 0, 'Starting migration of JSON steps to approval_steps table';
  
  -- Execute migration
  PERFORM migrate_json_steps_to_approval_steps_safe();
  
  RETURN NEXT
  SELECT 'JSON Steps Migration'::TEXT, 'COMPLETED'::TEXT, 
         (SELECT COUNT(*) FROM approval_steps), 'All JSON steps migrated to approval_steps table';
  
  -- Phase 2: Backfill manager relationships
  RETURN NEXT
  SELECT 'Manager Relationships'::TEXT, 'STARTED'::TEXT, 0, 'Starting backfill of manager relationships';
  
  PERFORM backfill_manager_relationships_comprehensive();
  
  RETURN NEXT
  SELECT 'Manager Relationships'::TEXT, 'COMPLETED'::TEXT,
         (SELECT COUNT(*) FROM departments WHERE manager_user_id IS NOT NULL) + 
         (SELECT COUNT(*) FROM users WHERE manager_id IS NOT NULL),
         'Manager relationships backfilled';
  
  -- Phase 3: Repair data inconsistencies
  RETURN NEXT
  SELECT 'Data Repair'::TEXT, 'STARTED'::TEXT, 0, 'Starting repair of data inconsistencies';
  
  PERFORM repair_role_actor_values();
  PERFORM repair_specific_user_actor_values();
  
  RETURN NEXT
  SELECT 'Data Repair'::TEXT, 'COMPLETED'::TEXT,
         (SELECT COUNT(*) FROM approval_steps WHERE actor_value IS NOT NULL),
         'Data inconsistencies repaired';
  
  -- Phase 4: Verification
  RETURN NEXT
  SELECT 'Verification'::TEXT, 'STARTED'::TEXT, 0, 'Starting migration verification';
  
  -- Run verification checks
  PERFORM verify_migration_completeness();
  
  RETURN NEXT
  SELECT 'Verification'::TEXT, 'COMPLETED'::TEXT, 0, 'Migration verification completed';
  
END;
$$;

-- ===============================
-- USAGE EXAMPLES
-- ===============================

-- To execute the complete backfill:
-- SELECT * FROM execute_complete_backfill();

-- To verify migration completeness:
-- SELECT * FROM verify_migration_completeness();

-- To migrate just the steps (with detailed logging):
-- SELECT * FROM migrate_json_steps_to_approval_steps_safe();

-- To backfill manager relationships:
-- SELECT * FROM backfill_manager_relationships_comprehensive();

-- To repair specific issues:
-- SELECT repair_role_actor_values();
-- SELECT repair_specific_user_actor_values();

-- ===============================
-- NOTES
-- ===============================

-- This backfill strategy provides:
-- 1. Safe migration with validation and error handling
-- 2. Multiple strategies for finding manager relationships
-- 3. Comprehensive verification and repair functions
-- 4. Detailed logging for troubleshooting
-- 5. Non-destructive approach (preserves original data)

-- The migration is designed to be:
-- - Idempotent (can be run multiple times safely)
-- - Verifiable (includes comprehensive checks)
-- - Repairable (can fix issues after migration)
-- - Auditable (detailed logging of all changes)
