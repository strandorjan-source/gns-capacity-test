-- Displayed email must match the identity in the signed Supabase access token.
ALTER POLICY capacity_profiles_self_insert ON public.capacity_profiles TO authenticated
WITH CHECK (user_id=(SELECT auth.uid()) AND role='carrier' AND approved=false AND email <> ''
 AND lower(email)=lower((SELECT auth.jwt())->>'email'));
ALTER TABLE public.capacity_profiles ADD CONSTRAINT capacity_profile_display_lengths
CHECK (coalesce(char_length(full_name),0) <= 200 AND coalesce(char_length(company),0) <= 200);
