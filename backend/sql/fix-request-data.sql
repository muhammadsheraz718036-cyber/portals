-- Fix the current request data
-- Update current_step to 2 since step 1 is approved
UPDATE approval_requests 
SET current_step = 2, updated_at = now() 
WHERE id = '362bbe99-538d-4350-b2c7-c3e67a51aca7';

-- Remove the incorrect changes_requested actions for steps 2 and 3
DELETE FROM approval_actions 
WHERE request_id = '362bbe99-538d-4350-b2c7-c3e67a51aca7' 
AND status = 'changes_requested' 
AND acted_by IS NULL;

-- Verify the fix
SELECT 
    ar.request_number,
    ar.current_step,
    ar.status,
    aa.step_order,
    aa.role_name,
    aa.status as action_status,
    aa.acted_by
FROM approval_requests ar
JOIN approval_actions aa ON ar.id = aa.request_id
WHERE ar.id = '362bbe99-538d-4350-b2c7-c3e67a51aca7'
ORDER BY aa.step_order, aa.created_at;
