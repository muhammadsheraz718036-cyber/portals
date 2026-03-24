
-- Fix function search path
CREATE OR REPLACE FUNCTION public.generate_request_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.request_number := 'REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('request_number_seq')::text, 3, '0');
  RETURN NEW;
END;
$$;

-- Fix overly permissive audit log insert policy
DROP POLICY IF EXISTS "Authenticated can insert audit logs" ON public.audit_logs;
CREATE POLICY "Authenticated can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
