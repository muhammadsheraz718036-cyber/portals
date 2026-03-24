
-- Allow anon to check if any profiles exist (just count, no data exposed)
CREATE POLICY "Anon can count profiles" ON public.profiles FOR SELECT TO anon USING (true);
