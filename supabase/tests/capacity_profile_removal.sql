-- Run with execute_sql / SQL editor. Only generated test identities are used.
-- Nothing survives ROLLBACK. Shared order-system identities are preserved.
begin;
do $$
#variable_conflict use_variable
declare
  admin_id uuid := gen_random_uuid(); admin2_id uuid := gen_random_uuid();
  carrier_id uuid := gen_random_uuid(); dispatcher_id uuid := gen_random_uuid();
  pending_id uuid := gen_random_uuid(); new_id uuid := gen_random_uuid();
  vehicle_id uuid := gen_random_uuid(); viewer uuid; affected integer; event_count integer;
begin
  insert into auth.users(id,email,raw_user_meta_data)
  select id,id::text||'@capacity-removal-test.invalid','{}'::jsonb
  from unnest(array[admin_id,admin2_id,carrier_id,dispatcher_id,pending_id,new_id]) id;
  insert into public.capacity_profiles(user_id,email,full_name,role,approved)
  select id,id::text||'@capacity-removal-test.invalid','Removal test',
    case when id in(admin_id,admin2_id) then 'admin' when id=dispatcher_id then 'dispatcher' else 'carrier' end,
    id<>pending_id
  from unnest(array[admin_id,admin2_id,carrier_id,dispatcher_id,pending_id]) id;
  perform set_config('request.jwt.claim.sub',carrier_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated','email',carrier_id::text||'@capacity-removal-test.invalid')::text,true);
  execute 'set local role authenticated';
  insert into public.capacity_vehicles(id,owner_user_id,carrier,contact,phone,registration,location,loading_region,available_at,vehicle_type,door_type,status)
  values(vehicle_id,carrier_id,'Removal test','Test','00000000','T'||upper(substr(replace(vehicle_id::text,'-',''),1,12)),'Oslo','Sør-Norge',now()+interval '1 day','Termo','Bakdører','Ledig');
  foreach viewer in array array[carrier_id,dispatcher_id,pending_id] loop
    perform set_config('request.jwt.claim.sub',viewer::text,true);
    perform set_config('request.jwt.claims',json_build_object('sub',viewer,'role','authenticated')::text,true);
    begin
      update public.capacity_profiles set deleted_at=now() where user_id=pending_id;
      get diagnostics affected=row_count;
      if affected<>0 then raise exception 'Non-admin could remove pending request'; end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
  begin
    update public.capacity_profiles set deleted_at=now(),approved=false where user_id=admin_id;
    raise exception 'Administrator could delete themselves';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.capacity_profiles set deleted_at=now() where user_id=admin2_id;
    raise exception 'Active user could be deleted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.capacity_profiles set approved=false,deleted_at=now() where user_id=admin2_id;
    raise exception 'Revoke and delete did not require separate actions';
  exception when insufficient_privilege then null;
  end;
  update public.capacity_profiles set deleted_at='2000-01-01',deleted_by=carrier_id where user_id=pending_id and approved=false and deleted_at is null;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Pending request was not removed'; end if;
  if not exists(select 1 from public.capacity_profiles where user_id=pending_id and not approved and deleted_by=admin_id and deleted_at>now()-interval '1 minute') then raise exception 'Server deletion attribution failed'; end if;
  update public.capacity_profiles set deleted_at=now() where user_id=admin2_id and approved=false and deleted_at is null;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Stale approval race not blocked'; end if;
  update public.capacity_vehicles set status='Reservert',reservation_comment='Retain history after profile removal' where id=vehicle_id;
  select count(*) into event_count from public.capacity_vehicle_events where capacity_vehicle_events.vehicle_id=vehicle_id;
  if event_count<2 then raise exception 'Test history not created'; end if;
  update public.capacity_profiles set approved=false where user_id=carrier_id;
  update public.capacity_profiles set deleted_at=now() where user_id=carrier_id and approved=false and deleted_at is null;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Revoked profile could not be removed'; end if;
  if not exists(select 1 from public.capacity_vehicles where id=vehicle_id and status='Reservert' and reservation_comment='Retain history after profile removal') then raise exception 'Vehicle or reservation lost'; end if;
  if (select count(*) from public.capacity_vehicle_events where capacity_vehicle_events.vehicle_id=vehicle_id)<>event_count then raise exception 'History changed during removal'; end if;
  if exists(select 1 from public.capacity_profiles where user_id in(pending_id,carrier_id) and deleted_at is null) then raise exception 'Removed profiles still in active list'; end if;
  begin
    update public.capacity_profiles set deleted_at=null,deleted_by=null,approved=true where user_id=carrier_id;
    raise exception 'Removed user reactivated through existing approval endpoint';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.capacity_profiles where user_id=carrier_id;
    raise exception 'Hard deletion still possible through client';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',carrier_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated','email',carrier_id::text||'@capacity-removal-test.invalid')::text,true);
  if (select private.capacity_current_role()) is not null then raise exception 'Removed profile retains access'; end if;
  if not exists(select 1 from public.capacity_profiles where user_id=carrier_id and deleted_at is not null) then raise exception 'Returning user cannot see tombstone'; end if;
  if exists(select 1 from public.capacity_vehicles where id=vehicle_id) then raise exception 'Removed carrier can still see vehicles'; end if;
  update public.capacity_profiles set full_name='Try resubmit',deleted_at=null,deleted_by=null where user_id=carrier_id;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Removed user could resubmit'; end if;
  begin
    insert into public.capacity_profiles(user_id,email,role,approved) values(carrier_id,carrier_id::text||'@capacity-removal-test.invalid','carrier',false);
    raise exception 'Returning removed user recreated request';
  exception when unique_violation then null;
  end;
  perform set_config('request.jwt.claim.sub',new_id::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',new_id,'role','authenticated','email',new_id::text||'@capacity-removal-test.invalid')::text,true);
  begin
    insert into public.capacity_profiles(user_id,email,role,approved,deleted_at,deleted_by) values(new_id,new_id::text||'@capacity-removal-test.invalid','carrier',false,now(),admin_id);
    raise exception 'New user could forge deletion';
  exception when insufficient_privilege then null;
  end;
  insert into public.capacity_profiles(user_id,email,role,approved) values(new_id,new_id::text||'@capacity-removal-test.invalid','carrier',false);
  execute 'reset role';
  if not exists(select 1 from auth.users where id=carrier_id) or not exists(select 1 from public.profiles where id=carrier_id) then raise exception 'Shared Auth/Order identity lost'; end if;
end $$;
rollback;
select 'PASS: pending/revoked removal, admin-only, self/active protections, stale approval guard, audit attribution, history/identity retention, no reactivation or duplicate requests. Test fixtures rolled back.' as result;
