ALTER TABLE approval_steps
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS scope_type TEXT,
  ADD COLUMN IF NOT EXISTS scope_value TEXT;

ALTER TABLE request_steps
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS scope_type TEXT,
  ADD COLUMN IF NOT EXISTS scope_value TEXT,
  ADD COLUMN IF NOT EXISTS approver_user_id UUID REFERENCES profiles(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approval_steps_scope_type_check'
  ) THEN
    ALTER TABLE approval_steps
      ADD CONSTRAINT approval_steps_scope_type_check
      CHECK (scope_type IS NULL OR scope_type IN ('initiator_department', 'fixed_department', 'static', 'expression'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'request_steps_scope_type_check'
  ) THEN
    ALTER TABLE request_steps
      ADD CONSTRAINT request_steps_scope_type_check
      CHECK (scope_type IS NULL OR scope_type IN ('initiator_department', 'fixed_department', 'static', 'expression'));
  END IF;
END $$;

UPDATE approval_steps
SET role = COALESCE(role, actor_value)
WHERE actor_type = 'ROLE'
  AND role IS NULL
  AND actor_value IS NOT NULL;

UPDATE approval_steps
SET role = 'Department Manager',
    scope_type = COALESCE(scope_type, CASE WHEN actor_value IS NULL THEN 'initiator_department' ELSE 'fixed_department' END),
    scope_value = COALESCE(scope_value, actor_value)
WHERE actor_type = 'DEPARTMENT_MANAGER';

UPDATE approval_steps
SET role = COALESCE(role, 'Line Manager'),
    scope_type = COALESCE(scope_type, 'expression'),
    scope_value = COALESCE(scope_value, 'initiator_manager')
WHERE actor_type = 'USER_MANAGER';

UPDATE approval_steps
SET role = COALESCE(role, 'Specific User'),
    scope_type = COALESCE(scope_type, 'expression'),
    scope_value = COALESCE(scope_value, CONCAT('user:', actor_value))
WHERE actor_type = 'SPECIFIC_USER'
  AND actor_value IS NOT NULL;

UPDATE approval_steps
SET scope_type = COALESCE(scope_type, 'static')
WHERE scope_type IS NULL;

UPDATE request_steps
SET approver_user_id = COALESCE(approver_user_id, assigned_to),
    role = COALESCE(role, actor_value),
    scope_type = COALESCE(scope_type, 'static')
WHERE approver_user_id IS NULL OR role IS NULL OR scope_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_request_steps_approver_status
  ON request_steps(approver_user_id, status)
  WHERE status IN ('PENDING', 'WAITING');

UPDATE department_managers dm
SET is_active = false
FROM profiles p
LEFT JOIN roles r ON r.id = p.role_id
WHERE dm.user_id = p.id
  AND (
    p.is_active = false
    OR p.department_id IS NULL
    OR lower(trim(COALESCE(r.name, ''))) <> lower('Department Manager')
    OR dm.department_id <> p.department_id
  );

INSERT INTO department_managers (department_id, user_id, is_active)
SELECT p.department_id, p.id, true
FROM profiles p
JOIN roles r ON r.id = p.role_id
WHERE p.is_active = true
  AND p.department_id IS NOT NULL
  AND lower(trim(r.name)) = lower('Department Manager')
ON CONFLICT (department_id, user_id)
DO UPDATE SET is_active = true;

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
  resolved_department_id UUID;
  specific_user_id UUID;
BEGIN
  SELECT * INTO step FROM approval_steps WHERE id = p_step_id;
  SELECT * INTO request FROM approval_requests WHERE id = p_request_id;

  IF step IS NULL OR request IS NULL THEN
    RETURN;
  END IF;

  IF step.scope_type = 'initiator_department' THEN
    resolved_department_id := request.department_id;
  ELSIF step.scope_type = 'fixed_department' THEN
    IF step.scope_value ~* '^[0-9a-f-]{36}$' THEN
      resolved_department_id := step.scope_value::UUID;
    ELSE
      SELECT id INTO resolved_department_id
      FROM departments
      WHERE lower(trim(name)) = lower(trim(step.scope_value))
      LIMIT 1;
    END IF;
  ELSIF step.scope_type = 'expression' AND step.scope_value IN ('initiator.department_id', 'request.department_id') THEN
    resolved_department_id := request.department_id;
  ELSIF step.scope_type = 'expression' AND step.scope_value LIKE 'department:%' THEN
    SELECT id INTO resolved_department_id
    FROM departments
    WHERE lower(trim(name)) = lower(trim(split_part(step.scope_value, ':', 2)))
    LIMIT 1;
  END IF;

  IF step.scope_type = 'expression' AND step.scope_value = 'initiator_manager' THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.email, p.department_id
    FROM profiles p
    JOIN user_managers um ON p.id = um.manager_id
    WHERE um.user_id = request.initiator_id
      AND um.is_active = true
      AND p.is_active = true
      AND p.id <> request.initiator_id
    ORDER BY um.assigned_at ASC, p.created_at ASC
    LIMIT 1;
    RETURN;
  END IF;

  IF step.scope_type = 'expression' AND step.scope_value LIKE 'user:%' THEN
    specific_user_id := split_part(step.scope_value, ':', 2)::UUID;
    RETURN QUERY
    SELECT p.id, p.full_name, p.email, p.department_id
    FROM profiles p
    WHERE p.id = specific_user_id
      AND p.is_active = true
      AND p.id <> request.initiator_id
    LIMIT 1;
    RETURN;
  END IF;

  IF COALESCE(step.role, step.actor_value) IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.email, p.department_id
    FROM profiles p
    LEFT JOIN roles primary_role ON primary_role.id = p.role_id
    LEFT JOIN user_roles ur ON ur.user_id = p.id
    LEFT JOIN roles secondary_role ON secondary_role.id = ur.role_id
    WHERE (
      lower(trim(primary_role.name)) = lower(trim(COALESCE(step.role, step.actor_value)))
      OR lower(trim(secondary_role.name)) = lower(trim(COALESCE(step.role, step.actor_value)))
    )
      AND p.is_active = true
      AND p.id <> request.initiator_id
      AND (
        resolved_department_id IS NULL
        OR p.department_id = resolved_department_id
      )
    GROUP BY p.id, p.full_name, p.email, p.department_id
    ORDER BY MIN(p.created_at) ASC
    LIMIT 1;
    RETURN;
  END IF;
END;
$$;
