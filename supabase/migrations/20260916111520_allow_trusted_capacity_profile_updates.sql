create or replace function private.capacity_protect_profile_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role is distinct from new.role
     or old.approved is distinct from new.approved then
    -- Authenticated application users must be admins. Database maintenance and
    -- trusted backend jobs have no auth.uid() claim and remain operable.
    if (select auth.uid()) is not null
       and coalesce((select private.capacity_current_role()), '') <> 'admin' then
      raise exception 'Only an administrator can change role or approval';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.capacity_protect_profile_access() from public;
revoke all on function private.capacity_protect_profile_access() from anon;
revoke all on function private.capacity_protect_profile_access() from authenticated;
