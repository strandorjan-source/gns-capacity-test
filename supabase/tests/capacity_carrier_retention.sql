-- No test identities, vehicles or events survive this transaction.
BEGIN;
DO $$
#variable_conflict use_variable
DECLARE
 admin_id uuid:=gen_random_uuid(); carrier_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
 vehicle_ids uuid[]:='{}'; vehicle_id uuid; days int; n int;
 loading_day timestamptz := (date_trunc('day', statement_timestamp() AT TIME ZONE 'Europe/Oslo') + interval '8 hours') AT TIME ZONE 'Europe/Oslo';
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT id,id::text||'@capacity-retention-test.invalid','{}'::jsonb FROM unnest(ARRAY[admin_id,carrier_id,other_id]) id;
 INSERT INTO public.capacity_profiles(user_id,email,full_name,role,approved)
 SELECT id,id::text||'@capacity-retention-test.invalid','Retention Test',CASE WHEN id=admin_id THEN 'admin' ELSE 'carrier' END,true
 FROM unnest(ARRAY[admin_id,carrier_id,other_id]) id
 ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,approved=true;

 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 FOR days IN 0..4 LOOP
  vehicle_id:=gen_random_uuid(); vehicle_ids:=array_append(vehicle_ids,vehicle_id);
  INSERT INTO public.capacity_vehicles(id,owner_user_id,carrier,registration,location,available_at,door_type,loading_region)
  VALUES(vehicle_id,carrier_id,'RETENTION TEST','RT'||substr(vehicle_id::text,1,8),'Bodø',loading_day,'Maskinsemi','Nord-Norge');
 END LOOP;

 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 UPDATE public.capacity_vehicles SET status='Reservert',reservation_comment='Retention test load' WHERE id=ANY(vehicle_ids);
 FOR days IN 0..4 LOOP
  -- Move already reserved fixtures backwards; this does not reserve historical vehicles.
  UPDATE public.capacity_vehicles SET available_at=loading_day-make_interval(days=>days) WHERE id=vehicle_ids[days+1];
 END LOOP;
 SELECT count(*) INTO n FROM public.capacity_vehicle_overview WHERE id=ANY(vehicle_ids) AND NOT is_history;
 IF n<>1 THEN RAISE EXCEPTION 'staff marketplace should show only current/future dates'; END IF;

 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 SELECT count(*) INTO n FROM public.capacity_vehicle_overview WHERE id=ANY(vehicle_ids) AND NOT is_history;
 IF n<>4 THEN RAISE EXCEPTION 'carrier should retain loading day and all three following days'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_ids[4] AND NOT is_history AND reserved_by=admin_id AND reservation_comment='Retention test load') THEN RAISE EXCEPTION 'third day or booking attribution missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_ids[5] AND is_history) THEN RAISE EXCEPTION 'fourth day should be in history'; END IF;
 INSERT INTO public.capacity_vehicles(owner_user_id,carrier,registration,location,available_at,door_type)
 VALUES(carrier_id,'RETENTION TEST','RF'||substr(carrier_id::text,1,8),'Bodø',loading_day-interval '1 day','Bakdører') RETURNING id INTO vehicle_id;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_id AND is_history) THEN RAISE EXCEPTION 'unreserved past vehicle should remain historical'; END IF;

 PERFORM set_config('request.jwt.claim.sub',other_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',other_id,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.capacity_vehicle_overview WHERE id=ANY(vehicle_ids)) THEN RAISE EXCEPTION 'another carrier can see retained vehicles'; END IF;

 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 UPDATE public.capacity_vehicles SET deleted_at=now() WHERE id=vehicle_ids[3];
 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_ids[3] AND is_history AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'deleted vehicle must stay historical'; END IF;
 EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'PASS: carrier keeps own reserved vehicles through day 3, day 4 enters history, staff dates and owner isolation preserved; fixtures rolled back' AS result;
