-- Allow approval_actions to record initiator resubmission after changes were requested.
ALTER TABLE approval_actions DROP CONSTRAINT IF EXISTS approval_actions_status_check;
ALTER TABLE approval_actions
ADD CONSTRAINT approval_actions_status_check
CHECK (status IN (
  'waiting',
  'pending',
  'approved',
  'rejected',
  'skipped',
  'changes_requested',
  'resubmitted'
));
