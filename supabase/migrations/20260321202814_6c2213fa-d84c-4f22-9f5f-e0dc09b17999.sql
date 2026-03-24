
-- Departments table
CREATE TABLE public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  head_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles table
CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profiles table (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approval types table
CREATE TABLE public.approval_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  fields JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approval chains table
CREATE TABLE public.approval_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  approval_type_id UUID REFERENCES public.approval_types(id) ON DELETE CASCADE,
  steps JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approval requests table
CREATE TABLE public.approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT NOT NULL UNIQUE,
  approval_type_id UUID REFERENCES public.approval_types(id) NOT NULL,
  approval_chain_id UUID REFERENCES public.approval_chains(id),
  initiator_id UUID REFERENCES auth.users(id) NOT NULL,
  department_id UUID REFERENCES public.departments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected')),
  current_step INTEGER NOT NULL DEFAULT 1,
  total_steps INTEGER NOT NULL DEFAULT 1,
  form_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approval timeline/actions table
CREATE TABLE public.approval_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES public.approval_requests(id) ON DELETE CASCADE NOT NULL,
  step_order INTEGER NOT NULL,
  role_name TEXT NOT NULL,
  action_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  acted_by UUID REFERENCES auth.users(id),
  comment TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Security definer function to check admin status
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = _user_id),
    false
  )
$$;

-- Departments: all authenticated can read, only admin can write
CREATE POLICY "Anyone can read departments" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert departments" ON public.departments FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update departments" ON public.departments FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete departments" ON public.departments FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Roles: all authenticated can read, only admin can write
CREATE POLICY "Anyone can read roles" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert roles" ON public.roles FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update roles" ON public.roles FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete roles" ON public.roles FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Profiles: users can read own, admin can read/write all
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Admins can insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete profiles" ON public.profiles FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Approval types: all can read, admin writes
CREATE POLICY "Anyone can read approval types" ON public.approval_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert approval types" ON public.approval_types FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update approval types" ON public.approval_types FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete approval types" ON public.approval_types FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Approval chains: all can read, admin writes
CREATE POLICY "Anyone can read chains" ON public.approval_chains FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert chains" ON public.approval_chains FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update chains" ON public.approval_chains FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete chains" ON public.approval_chains FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Approval requests: initiator can read own, admin can read all, relevant role holders can read assigned
CREATE POLICY "Users can read own requests" ON public.approval_requests FOR SELECT TO authenticated USING (initiator_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "Users can insert requests" ON public.approval_requests FOR INSERT TO authenticated WITH CHECK (initiator_id = auth.uid());
CREATE POLICY "Admins can update requests" ON public.approval_requests FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));

-- Approval actions: readable by request participants
CREATE POLICY "Users can read actions" ON public.approval_actions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert actions" ON public.approval_actions FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update actions" ON public.approval_actions FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()) OR acted_by = auth.uid());

-- Audit logs: only admin can read, system inserts
CREATE POLICY "Admins can read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Authenticated can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Function to generate request number
CREATE OR REPLACE FUNCTION public.generate_request_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.request_number := 'REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('request_number_seq')::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS request_number_seq START 1;

CREATE TRIGGER set_request_number
  BEFORE INSERT ON public.approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_request_number();
