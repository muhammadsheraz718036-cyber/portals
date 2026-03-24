
-- Create initial admin profile (will be linked when admin user is created)
-- We need to use a different approach - let's allow the first signup to self-register as admin
-- by temporarily allowing insert on profiles for the user themselves
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
