
-- 1. Create department_managers table (referenced by code but missing)
CREATE TABLE IF NOT EXISTS public.department_managers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  assigned_by UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department_id, user_id)
);

ALTER TABLE public.department_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read department managers"
  ON public.department_managers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage department managers"
  ON public.department_managers FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- 2. Add approver_user_id to approval_actions for distinct routing.
-- Each action targets ONE specific user (resolved at submit time) so role-collision across departments stops being a problem.
ALTER TABLE public.approval_actions
  ADD COLUMN IF NOT EXISTS approver_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_approval_actions_approver_user
  ON public.approval_actions(approver_user_id)
  WHERE approver_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_actions_request_status
  ON public.approval_actions(request_id, status);

-- 3. Allow the assigned approver to update their own pending action via RLS
DROP POLICY IF EXISTS "Admins can update actions" ON public.approval_actions;
CREATE POLICY "Admin or assigned approver can update actions"
  ON public.approval_actions FOR UPDATE
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR acted_by = auth.uid()
    OR approver_user_id = auth.uid()
  );

-- 4. Allow backend (running with service role) and admins to insert; also let initiator's request creation cascade by allowing inserts for assigned chain rows.
-- (Backend already uses pool/service role; this just keeps RLS intact for direct supabase clients.)
DROP POLICY IF EXISTS "Admins can insert actions" ON public.approval_actions;
CREATE POLICY "Admins or system can insert actions"
  ON public.approval_actions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
