-- Align database objects with strict assignee-only approval routing.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGSERIAL PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_actions_pending_assignee
  ON approval_actions(approver_user_id, request_id, step_order)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_create_approval_actions ON approval_requests;
DROP FUNCTION IF EXISTS create_approval_actions_for_request();

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
      LEFT JOIN roles primary_role ON primary_role.id = p.role_id
      LEFT JOIN user_roles ur ON ur.user_id = p.id
      LEFT JOIN roles secondary_role ON secondary_role.id = ur.role_id
      WHERE (
        lower(trim(primary_role.name)) = lower(trim(step.actor_value))
        OR lower(trim(secondary_role.name)) = lower(trim(step.actor_value))
      )
      AND p.is_active = true
      AND p.id <> request.initiator_id
      AND (
        p.department_id = request.department_id
        OR p.department_id IS NULL
        OR request.department_id IS NULL
      );

    WHEN 'USER_MANAGER' THEN
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      JOIN user_managers um ON p.id = um.manager_id
      WHERE um.user_id = request.initiator_id
      AND um.is_active = true
      AND p.is_active = true
      AND p.id <> request.initiator_id;

    WHEN 'DEPARTMENT_MANAGER' THEN
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      JOIN department_managers dm ON p.id = dm.user_id
      WHERE dm.department_id = request.department_id
      AND dm.is_active = true
      AND p.is_active = true
      AND p.id <> request.initiator_id;

    WHEN 'SPECIFIC_USER' THEN
      RETURN QUERY
      SELECT p.id, p.full_name, p.email, p.department_id
      FROM profiles p
      WHERE p.id = step.actor_value::UUID
      AND p.is_active = true
      AND p.id <> request.initiator_id;
  END CASE;
END;
$$;

WITH candidates AS (
  SELECT
    aa.id,
    COALESCE(
      (
        SELECT p.id
        FROM profiles p
        LEFT JOIN roles primary_role ON primary_role.id = p.role_id
        LEFT JOIN user_roles ur ON ur.user_id = p.id
        LEFT JOIN roles secondary_role ON secondary_role.id = ur.role_id
        WHERE p.department_id = ar.department_id
          AND (
            lower(trim(primary_role.name)) = lower(trim(aa.role_name))
            OR lower(trim(secondary_role.name)) = lower(trim(aa.role_name))
          )
          AND p.is_active = true
          AND p.id <> ar.initiator_id
        GROUP BY p.id
        ORDER BY MIN(p.created_at) ASC
        LIMIT 1
      ),
      (
        SELECT p.id
        FROM department_managers dm
        JOIN profiles p ON p.id = dm.user_id
        WHERE dm.department_id = ar.department_id
          AND dm.is_active = true
          AND p.is_active = true
          AND p.id <> ar.initiator_id
        ORDER BY dm.assigned_at ASC
        LIMIT 1
      ),
      (
        SELECT p.id
        FROM profiles p
        LEFT JOIN roles primary_role ON primary_role.id = p.role_id
        LEFT JOIN user_roles ur ON ur.user_id = p.id
        LEFT JOIN roles secondary_role ON secondary_role.id = ur.role_id
        WHERE (
          lower(trim(primary_role.name)) = lower(trim(aa.role_name))
          OR lower(trim(secondary_role.name)) = lower(trim(aa.role_name))
        )
          AND p.is_active = true
          AND p.id <> ar.initiator_id
        GROUP BY p.id
        ORDER BY MIN(p.created_at) ASC
        LIMIT 1
      ),
      (
        SELECT p.id
        FROM profiles p
        WHERE p.is_admin = true
          AND p.is_active = true
          AND p.id <> ar.initiator_id
        ORDER BY p.created_at ASC
        LIMIT 1
      )
    ) AS resolved
  FROM approval_actions aa
  JOIN approval_requests ar ON ar.id = aa.request_id
  WHERE aa.approver_user_id IS NULL
    AND aa.status IN ('pending', 'waiting')
)
UPDATE approval_actions aa
SET approver_user_id = candidates.resolved
FROM candidates
WHERE aa.id = candidates.id
  AND candidates.resolved IS NOT NULL;
