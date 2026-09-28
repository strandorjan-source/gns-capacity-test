set local lock_timeout = '5s';

-- Keep identities and operational history; remove only from the active user list.
alter table public.capacity_profiles
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete set null,
  add constraint capacity_profiles_removed_access_check check (
    (deleted_at is null and deleted_by is null) or (deleted_at is not null and approved = false)
  );

create or replace function private.capacity_current_role()
returns text language sql stable security definer set search_path = ''
as $$
  select cp.role from public.capacity_profiles cp
  where cp.user_id = (select auth.uid()) and cp.approved = true and cp.deleted_at is null
  limit 1
$$;

create function private.enforce_capacity_profile_removal()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if old.deleted_at is not null then
    raise exception 'Removed Capacity profiles cannot be changed or reactivated' using errcode = '42501';
  end if;
  if (new.deleted_at, new.deleted_by) is distinct from (old.deleted_at, old.deleted_by) then
    if coalesce((select private.capacity_current_role()), '') <> 'admin' or old.user_id = auth.uid() then
      raise exception 'Only another administrator can remove a Capacity profile' using errcode = '42501';
    end if;
    if old.approved or new.approved or new.deleted_at is null then
      raise exception 'Revoke access before removing a Capacity profile' using errcode = '42501';
    end if;
    -- Do not allow caller-supplied audit identity or timestamps.
    new.deleted_at := clock_timestamp();
    new.deleted_by := auth.uid();
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_capacity_profile_removal() from public, anon, authenticated;
create trigger capacity_profile_removal_guard before update on public.capacity_profiles
for each row execute function private.enforce_capacity_profile_removal();

alter policy capacity_profiles_self_update on public.capacity_profiles
using (user_id = (select auth.uid()) and deleted_at is null)
with check (user_id = (select auth.uid()) and deleted_at is null and deleted_by is null);

alter policy capacity_profiles_self_insert on public.capacity_profiles
with check (
  user_id = (select auth.uid()) and role = 'carrier' and approved = false
  and email <> '' and lower(email) = lower((select auth.jwt()) ->> 'email')
  and deleted_at is null and deleted_by is null
);

-- Retain the existing SELECT-own policy so returning users see the tombstone,
-- rather than creating another pending request. No auth.users are deleted.
revoke delete on public.capacity_profiles from authenticated, anon;
comment on column public.capacity_profiles.deleted_at is 'Removed from Capacity user administration. Access stays revoked; operational history is retained.';
notify pgrst, 'reload schema';
