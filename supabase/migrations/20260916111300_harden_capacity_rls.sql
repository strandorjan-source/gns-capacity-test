-- Prevent users from approving themselves or changing their own role.  The
-- profile update policy intentionally allows users to maintain their name and
-- company, so protected columns are enforced with a trigger as defence in
-- depth.
create or replace function private.capacity_protect_profile_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role is distinct from new.role
     or old.approved is distinct from new.approved then
    if coalesce((select private.capacity_current_role()), '') <> 'admin' then
      raise exception 'Only an administrator can change role or approval';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.capacity_protect_profile_access() from public;
revoke all on function private.capacity_protect_profile_access() from anon;
revoke all on function private.capacity_protect_profile_access() from authenticated;

drop trigger if exists capacity_profiles_protect_access on public.capacity_profiles;
create trigger capacity_profiles_protect_access
before update on public.capacity_profiles
for each row execute function private.capacity_protect_profile_access();

-- Carriers may maintain their own available vehicles, but reservation state is
-- controlled exclusively by approved GNS staff.
drop policy if exists capacity_vehicles_update on public.capacity_vehicles;

create policy capacity_vehicles_staff_update
on public.capacity_vehicles
for update
to authenticated
using (
  (select private.capacity_current_role()) in ('admin', 'dispatcher')
)
with check (
  (select private.capacity_current_role()) in ('admin', 'dispatcher')
);

create policy capacity_vehicles_owner_update
on public.capacity_vehicles
for update
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select private.capacity_current_role()) = 'carrier'
  and status = 'Ledig'
  and reserved_by is null
  and reserved_at is null
)
with check (
  owner_user_id = (select auth.uid())
  and (select private.capacity_current_role()) = 'carrier'
  and status = 'Ledig'
  and reserved_by is null
  and reserved_at is null
);

drop policy if exists capacity_vehicles_delete on public.capacity_vehicles;

create policy capacity_vehicles_delete
on public.capacity_vehicles
for delete
to authenticated
using (
  (select private.capacity_current_role()) = 'admin'
  or (
    owner_user_id = (select auth.uid())
    and (select private.capacity_current_role()) = 'carrier'
    and status = 'Ledig'
    and reserved_by is null
    and reserved_at is null
  )
);
