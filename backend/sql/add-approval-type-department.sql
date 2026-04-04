-- Add department association to approval types
ALTER TABLE approval_types
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_approval_types_department_id ON approval_types(department_id);
