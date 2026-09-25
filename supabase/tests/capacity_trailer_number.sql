-- Exercise real RLS and triggers; all test identities, vehicles and events roll back.
BEGIN;
DO $$
#variable_conflict use_variable
DECLARE
 carrier_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
 admin_id uuid:=gen_random_uuid(); dispatcher_id uuid:=gen_random_uuid();
 vehicle_id uuid:=gen_random_uuid(); affected int; booking_before jsonb; booking_after jsonb;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT id,id::text||'@capacity-trailer-test.invalid','{}'::jsonb
 FROM unnest(ARRAY[carrier_id,other_id,admin_id,dispatcher_id]) id;
 INSERT INTO public.capacity_profiles(user_id,email,full_name,role,approved)
 SELECT id,id::text||'@capacity-trailer-test.invalid','Trailer Test',
 CASE WHEN id=admin_id THEN 'admin' WHEN id=dispatcher_id THEN 'dispatcher' ELSE 'carrier' END,true
 FROM unnest(ARRAY[carrier_id,other_id,admin_id,dispatcher_id]) id
 ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,approved=true;

 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 INSERT INTO public.capacity_vehicles(id,owner_user_id,carrier,contact,phone,registration,trailer_number,location,available_at,vehicle_type,door_type,loading_region)
 VALUES(vehicle_id,carrier_id,'TRAILER TEST','Test','00000000','TT'||substr(vehicle_id::text,1,8),'  Tralle 007-A  ','Bodø',now()+interval '1 day','Termo','Bakdører','Nord-Norge');
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_id AND trailer_number='Tralle 007-A') THEN
  RAISE EXCEPTION 'Trailer not normalized or visible in overview';
 END IF;
 UPDATE public.capacity_vehicles SET registration='TX'||substr(vehicle_id::text,1,8),trailer_number='008',comment='Carrier edit' WHERE id=vehicle_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Carrier cannot edit own available vehicle'; END IF;

 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 UPDATE public.capacity_vehicles SET status='Reservert',reservation_comment='Keep booking' WHERE id=vehicle_id;
 SELECT jsonb_build_array(status,reserved_by,reserved_at,reserved_by_name,reserved_by_email,reservation_comment)
 INTO booking_before FROM public.capacity_vehicles WHERE id=vehicle_id;

 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 UPDATE public.capacity_vehicles SET trailer_number='009',location='Oslo',loading_region='Sør-Norge',comment='Reserved edit' WHERE id=vehicle_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Carrier cannot edit own reserved vehicle'; END IF;
 SELECT jsonb_build_array(status,reserved_by,reserved_at,reserved_by_name,reserved_by_email,reservation_comment)
 INTO booking_after FROM public.capacity_vehicles WHERE id=vehicle_id;
 IF booking_after IS DISTINCT FROM booking_before THEN RAISE EXCEPTION 'Editing changed booking'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicle_events e WHERE e.vehicle_id=vehicle_id AND actor_id=carrier_id AND action='edited'
  AND before_data->>'trailer_number'='008' AND after_data->>'trailer_number'='009') THEN
  RAISE EXCEPTION 'Trailer edit was not audited';
 END IF;
 BEGIN
  UPDATE public.capacity_vehicles SET status='Ledig' WHERE id=vehicle_id;
  RAISE EXCEPTION 'Carrier could release a booking';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.capacity_vehicles SET trailer_number=repeat('x',51) WHERE id=vehicle_id;
  RAISE EXCEPTION 'Oversized trailer number accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 UPDATE public.capacity_vehicles SET trailer_number=' ' WHERE id=vehicle_id;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicles WHERE id=vehicle_id AND trailer_number IS NULL) THEN RAISE EXCEPTION 'Trailer could not be cleared'; END IF;

 PERFORM set_config('request.jwt.claim.sub',other_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',other_id,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_id) THEN RAISE EXCEPTION 'Other carrier can see vehicle'; END IF;
 UPDATE public.capacity_vehicles SET trailer_number='Unauthorized' WHERE id=vehicle_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Other carrier can edit vehicle'; END IF;

 PERFORM set_config('request.jwt.claim.sub',dispatcher_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',dispatcher_id,'role','authenticated')::text,true);
 BEGIN
  UPDATE public.capacity_vehicles SET trailer_number='Unauthorized' WHERE id=vehicle_id;
  RAISE EXCEPTION 'Dispatcher could change trailer';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;

 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 UPDATE public.capacity_vehicles SET trailer_number='Admin edit' WHERE id=vehicle_id;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_vehicle_overview WHERE id=vehicle_id AND trailer_number='Admin edit') THEN RAISE EXCEPTION 'Admin edit failed'; END IF;
 EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'PASS: trailer create/edit/clear, own available and reserved edits, unchanged booking, audit, RLS isolation and staff permissions; all fixtures rolled back' AS result;
