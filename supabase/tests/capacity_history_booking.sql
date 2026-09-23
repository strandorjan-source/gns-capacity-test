-- Transactional integration checks. No user, profile, vehicle or event survives ROLLBACK.
BEGIN;
DO $$
#variable_conflict use_variable
DECLARE
 admin_id uuid:=gen_random_uuid(); dispatcher_id uuid:=gen_random_uuid();
 carrier_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid();
 vehicle_id uuid:=gen_random_uuid(); past_id uuid:=gen_random_uuid(); other_vehicle uuid:=gen_random_uuid();
 equipment text; area text; v public.capacity_vehicles; previous_time timestamptz; n int; ids uuid[];
BEGIN
 ids:=ARRAY[admin_id,dispatcher_id,carrier_id,other_id,pending_id];
 INSERT INTO auth.users(id,email,raw_user_meta_data) SELECT id,id::text||'@capacity-test.invalid','{}'::jsonb FROM unnest(ids) id;
 INSERT INTO public.capacity_profiles(user_id,email,full_name,role,approved)
 SELECT id,id::text||'@capacity-test.invalid',CASE WHEN id=dispatcher_id THEN 'Test Dispatcher' ELSE 'Test User' END,
 CASE WHEN id=admin_id THEN 'admin' WHEN id=dispatcher_id THEN 'dispatcher' ELSE 'carrier' END,id<>pending_id
 FROM unnest(ids) id ON CONFLICT (user_id) DO UPDATE SET role=excluded.role,approved=excluded.approved,full_name=excluded.full_name;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 INSERT INTO public.capacity_vehicles(id,owner_user_id,carrier,registration,location,available_at,door_type)
 VALUES(vehicle_id,carrier_id,'TEST CARRIER','QT '||substr(vehicle_id::text,1,8),'Oslo',date_trunc('day',now() AT TIME ZONE 'Europe/Oslo') AT TIME ZONE 'Europe/Oslo','Sideåpning');
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_id AND NOT is_history) THEN RAISE EXCEPTION 'same Norwegian day must stay active'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id=vehicle_id AND actor_id=carrier_id AND action='registered') THEN RAISE EXCEPTION 'registration not audited'; END IF;
 INSERT INTO public.capacity_vehicles(id,owner_user_id,carrier,registration,location,available_at,door_type)
 SELECT past_id,carrier_id,'TEST CARRIER',registration,'Bodø',available_at-interval '2 days','Bakdører' FROM public.capacity_vehicles WHERE id=vehicle_id;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_overview WHERE id=past_id AND is_history) THEN RAISE EXCEPTION 'past day must enter history'; END IF;
 BEGIN
  INSERT INTO public.capacity_vehicles(owner_user_id,carrier,registration,location,available_at,door_type)
  SELECT carrier_id,'TEST CARRIER',registration,'Oslo',available_at+interval '1 hour','Bakdører' FROM public.capacity_vehicles WHERE id=vehicle_id;
  RAISE EXCEPTION 'same-day duplicate accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.capacity_vehicles(owner_user_id,carrier,registration,location,available_at)
  VALUES(carrier_id,'TEST','NODOOR','Oslo',now()); RAISE EXCEPTION 'missing doors accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET status='Reservert' WHERE id=vehicle_id; RAISE EXCEPTION 'carrier reserved a vehicle';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

 -- New choices round-trip through the secured view and are audited.
 FOREACH equipment IN ARRAY ARRAY['Åpen semi','Flisbil','Maskinsemi'] LOOP
  FOREACH area IN ARRAY ARRAY['Nord-Norge','Midt-Norge','Sør-Norge','Utlandet'] LOOP
   UPDATE public.capacity_vehicles SET door_type=equipment, loading_region=area WHERE id=vehicle_id;
   IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_id AND door_type=equipment AND loading_region=area) THEN RAISE EXCEPTION 'equipment/region not visible'; END IF;
  END LOOP;
 END LOOP;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id=vehicle_id AND after_data->>'loading_region'='Utlandet' AND after_data->>'door_type'='Maskinsemi' AND actor_id=carrier_id) THEN RAISE EXCEPTION 'region not audited'; END IF;
 BEGIN
  UPDATE public.capacity_vehicles SET loading_region='INVALID' WHERE id=vehicle_id; RAISE EXCEPTION 'invalid region accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET door_type='INVALID' WHERE id=vehicle_id; RAISE EXCEPTION 'invalid equipment accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',other_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',other_id,'role','authenticated')::text,true);
 IF EXISTS (SELECT 1 FROM public.capacity_vehicle_overview WHERE id IN (vehicle_id,past_id)) THEN RAISE EXCEPTION 'carrier can see another carrier history'; END IF;
 IF EXISTS (SELECT 1 FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id IN (vehicle_id,past_id)) THEN RAISE EXCEPTION 'carrier can see another carrier audit'; END IF;
 UPDATE public.capacity_vehicles SET loading_region='Nord-Norge' WHERE id=vehicle_id;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'carrier edited another owner'; END IF;
 INSERT INTO public.capacity_vehicles(id,owner_user_id,carrier,registration,location,available_at,door_type)
 VALUES(other_vehicle,other_id,'OTHER','QT'||substr(other_vehicle::text,1,8),'Bodø',now(),'Bakdører');

 PERFORM set_config('request.jwt.claim.sub',dispatcher_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',dispatcher_id,'role','authenticated')::text,true);
 UPDATE public.capacity_vehicles SET status='Reservert',reserved_by=admin_id,reserved_at='2000-01-01',reserved_by_name='FORGED',reserved_by_email='forged@example.invalid',reservation_comment='Kunde – Oslo til Bodø' WHERE id=vehicle_id RETURNING * INTO v;
 IF v.reserved_by<>dispatcher_id OR v.reserved_by_name<>'Test Dispatcher' OR v.reserved_by_email<>dispatcher_id::text||'@capacity-test.invalid' OR v.reserved_at<now()-interval '1 minute' THEN RAISE EXCEPTION 'actor snapshot or timestamp is forgeable'; END IF;
 previous_time:=v.updated_at;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id=vehicle_id AND action='reserved' AND actor_id=dispatcher_id AND after_data->>'reservation_comment'='Kunde – Oslo til Bodø') THEN RAISE EXCEPTION 'reservation audit missing'; END IF;
 BEGIN
  UPDATE public.capacity_vehicles SET loading_region='Nord-Norge' WHERE id=vehicle_id; RAISE EXCEPTION 'dispatcher edited region';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET location='WRONG' WHERE id=vehicle_id; RAISE EXCEPTION 'dispatcher edited vehicle';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET deleted_at=now() WHERE id=vehicle_id; RAISE EXCEPTION 'dispatcher deleted vehicle';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET status='Reservert' WHERE id=past_id; RAISE EXCEPTION 'expired vehicle reserved';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET reservation_comment='overwritten' WHERE id=vehicle_id; RAISE EXCEPTION 'audit comment overwritten';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 BEGIN
  UPDATE public.capacity_vehicles SET deleted_at=now() WHERE id=vehicle_id; RAISE EXCEPTION 'owner deleted reserved vehicle';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.capacity_vehicles SET comment='Carrier corrected text',loading_region='Nord-Norge',door_type='Maskinsemi',contact='Updated contact',phone='12345' WHERE id=vehicle_id;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'carrier cannot edit own reserved vehicle'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicles WHERE id=vehicle_id AND status='Reservert' AND reserved_by=dispatcher_id AND reserved_at=v.reserved_at AND reservation_comment='Kunde – Oslo til Bodø' AND comment='Carrier corrected text' AND loading_region='Nord-Norge' AND door_type='Maskinsemi') THEN RAISE EXCEPTION 'carrier edit damaged reservation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id=vehicle_id AND action='edited' AND actor_id=carrier_id AND after_data->>'comment'='Carrier corrected text') THEN RAISE EXCEPTION 'carrier edit not audited'; END IF;
 BEGIN
  UPDATE public.capacity_vehicles SET status='Ledig' WHERE id=vehicle_id; RAISE EXCEPTION 'carrier released reservation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET reservation_comment='FORGED' WHERE id=vehicle_id; RAISE EXCEPTION 'carrier overwrote booking comment';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET reserved_by=carrier_id,reserved_by_name='FORGED' WHERE id=vehicle_id; RAISE EXCEPTION 'carrier changed booking actor';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicles SET owner_user_id=other_id WHERE id=vehicle_id; RAISE EXCEPTION 'carrier changed owner';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id=vehicle_id AND action='reserved') THEN RAISE EXCEPTION 'owner cannot see own reservation'; END IF;

 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 UPDATE public.capacity_vehicles SET location='Trondheim',loading_region='Midt-Norge',door_type='Sideåpning og bakdører' WHERE id=vehicle_id;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicles WHERE id=vehicle_id AND status='Reservert' AND reserved_by=dispatcher_id AND reserved_at=v.reserved_at AND reservation_comment='Kunde – Oslo til Bodø') THEN RAISE EXCEPTION 'admin edit reset reservation'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id=vehicle_id AND action='edited' AND before_data->>'location'='Oslo' AND after_data->>'location'='Trondheim') THEN RAISE EXCEPTION 'edit not audited'; END IF;
 UPDATE public.capacity_vehicles SET status='Ledig' WHERE id=vehicle_id AND updated_at=previous_time;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'stale update succeeded'; END IF;
 BEGIN
  UPDATE public.capacity_vehicles SET owner_user_id=admin_id WHERE id=vehicle_id; RAISE EXCEPTION 'owner reassigned';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.capacity_vehicles SET status='Ledig' WHERE id=vehicle_id;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicles WHERE id=vehicle_id AND reserved_by IS NULL AND reserved_at IS NULL AND reservation_comment IS NULL AND reserved_by_name IS NULL) THEN RAISE EXCEPTION 'release state inconsistent'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id=vehicle_id AND action='released' AND before_data->>'reservation_comment'='Kunde – Oslo til Bodø') THEN RAISE EXCEPTION 'release lost comment'; END IF;
 UPDATE public.capacity_vehicles SET deleted_at='2000-01-01',deleted_by=dispatcher_id WHERE id=vehicle_id;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_id AND is_history AND deleted_by=admin_id AND deleted_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'soft deletion missing or spoofed'; END IF;
 BEGIN
  DELETE FROM public.capacity_vehicles WHERE id=vehicle_id; RAISE EXCEPTION 'hard delete permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.capacity_vehicle_events SET actor_name='FORGED' WHERE capacity_vehicle_events.vehicle_id=vehicle_id; RAISE EXCEPTION 'audit writable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.capacity_vehicle_events(vehicle_id,owner_user_id,action,after_data) VALUES(vehicle_id,carrier_id,'reserved','{}'); RAISE EXCEPTION 'audit forgery permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.capacity_vehicles SET deleted_at=NULL WHERE id=vehicle_id;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_id AND NOT is_history AND deleted_at IS NULL AND deleted_by IS NULL) THEN RAISE EXCEPTION 'restore failed'; END IF;
 IF (SELECT count(*) FROM public.capacity_vehicle_events WHERE capacity_vehicle_events.vehicle_id=vehicle_id AND action IN ('deleted','restored'))<>2 THEN RAISE EXCEPTION 'delete and restore events missing'; END IF;

 PERFORM set_config('request.jwt.claim.sub',other_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',other_id,'role','authenticated')::text,true);
 UPDATE public.capacity_vehicles SET location='Narvik',door_type='Sideåpning',comment='Updated free vehicle' WHERE id=other_vehicle;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'carrier cannot edit own free vehicle'; END IF;
 UPDATE public.capacity_vehicles SET deleted_at=now() WHERE id=other_vehicle;
 IF NOT EXISTS (SELECT 1 FROM public.capacity_vehicle_overview WHERE id=other_vehicle AND is_history) THEN RAISE EXCEPTION 'carrier cannot delete own free vehicle'; END IF;
 UPDATE public.capacity_vehicles SET deleted_at=NULL WHERE id=other_vehicle;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'carrier restored a deleted vehicle'; END IF;

 PERFORM set_config('request.jwt.claim.sub',pending_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',pending_id,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.capacity_vehicle_overview) OR EXISTS(SELECT 1 FROM public.capacity_vehicle_events) THEN RAISE EXCEPTION 'pending user has data access'; END IF;
 EXECUTE 'RESET ROLE';
 UPDATE public.capacity_profiles SET approved=false WHERE user_id=carrier_id;
 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.capacity_vehicle_overview) OR EXISTS(SELECT 1 FROM public.capacity_vehicle_events) THEN RAISE EXCEPTION 'revoked carrier still has data access'; END IF;
 UPDATE public.capacity_vehicles SET comment='REVOKED' WHERE id=vehicle_id;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'revoked carrier can edit'; END IF;
 EXECUTE 'SET LOCAL ROLE anon';
 BEGIN
  PERFORM * FROM public.capacity_vehicle_overview; RAISE EXCEPTION 'anonymous overview readable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM * FROM public.capacity_vehicle_events; RAISE EXCEPTION 'anonymous audit readable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'PASS: loading regions, equipment, history, door types, actor attribution, audit, edit, soft delete/restore, conflicts and all roles; fixtures rolled back' AS result;
