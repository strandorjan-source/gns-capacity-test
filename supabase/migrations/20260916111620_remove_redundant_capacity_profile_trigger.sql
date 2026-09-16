-- The original Capacity schema already protects role and approval changes with
-- private.enforce_capacity_profile_privilege(). Keep one authoritative guard.
drop trigger if exists capacity_profiles_protect_access on public.capacity_profiles;
drop function if exists private.capacity_protect_profile_access();
