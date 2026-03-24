CREATE TABLE public.company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT 'ApprovalHub',
  logo_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read company settings" ON public.company_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anon can read company settings" ON public.company_settings FOR SELECT TO anon USING (true);
CREATE POLICY "Admins can update company settings" ON public.company_settings FOR UPDATE TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "Admins can insert company settings" ON public.company_settings FOR INSERT TO authenticated WITH CHECK (is_admin(auth.uid()));

INSERT INTO public.company_settings (company_name) VALUES ('ApprovalHub');