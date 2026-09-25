-- Verify the load board using real RLS. No test data survives the transaction.
BEGIN;
DO $$
#variable_conflict use_variable
DECLARE
 admin_id uuid:=gen_random_uuid(); admin2_id uuid:=gen_random_uuid();
 carrier_id uuid:=gen_random_uuid(); carrier2_id uuid:=gen_random_uuid();
 dispatcher_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid();
 load_id uuid:=gen_random_uuid(); viewer uuid; affected int; previous_update timestamptz;
 today date:=(statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT id,id::text||'@capacity-loads-test.invalid','{}'::jsonb
 FROM unnest(ARRAY[admin_id,admin2_id,carrier_id,carrier2_id,dispatcher_id,pending_id]) id;
 INSERT INTO public.capacity_profiles(user_id,email,full_name,role,approved)
 SELECT id,id::text||'@capacity-loads-test.invalid','Loads Test',
 CASE WHEN id IN (admin_id,admin2_id) THEN 'admin' WHEN id=dispatcher_id THEN 'dispatcher' ELSE 'carrier' END,id<>pending_id
 FROM unnest(ARRAY[admin_id,admin2_id,carrier_id,carrier2_id,dispatcher_id,pending_id]) id
 ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,approved=excluded.approved;

 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 INSERT INTO public.capacity_loads(id,pickup,delivery,loading_date,cargo,vehicle_requirements,contact_name,contact_phone,created_by)
 VALUES(load_id,' Bodø ',' Oslo ',today,'Fisk, 33 paller','Termo','GNS','00000000',carrier_id);
 IF NOT EXISTS(SELECT 1 FROM public.capacity_loads WHERE id=load_id AND pickup='Bodø' AND created_by=admin_id AND updated_by=admin_id) THEN
  RAISE EXCEPTION 'Admin create, normalization or server attribution failed';
 END IF;
 SELECT updated_at INTO previous_update FROM public.capacity_loads WHERE id=load_id;
 UPDATE public.capacity_loads SET cargo='Fisk, 30 paller',loading_time='12:30',delivery_date=today+1 WHERE id=load_id AND updated_at=previous_update;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Admin update failed'; END IF;
 UPDATE public.capacity_loads SET cargo='Stale overwrite' WHERE id=load_id AND updated_at=previous_update;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Stale edit overwrote newer data'; END IF;
 BEGIN
  UPDATE public.capacity_loads SET created_by=carrier_id WHERE id=load_id;
  RAISE EXCEPTION 'Creator could be forged';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.capacity_loads SET delivery_date=today-1 WHERE id=load_id;
  RAISE EXCEPTION 'Invalid delivery date accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;

 FOREACH viewer IN ARRAY ARRAY[carrier_id,carrier2_id,dispatcher_id,pending_id] LOOP
  PERFORM set_config('request.jwt.claim.sub',viewer::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',viewer,'role','authenticated')::text,true);
  SELECT count(*) INTO affected FROM public.capacity_loads WHERE id=load_id AND cargo='Fisk, 30 paller';
  IF affected <> (CASE WHEN viewer=pending_id THEN 0 ELSE 1 END) THEN RAISE EXCEPTION 'Approved cross-carrier visibility failed'; END IF;
  UPDATE public.capacity_loads SET cargo='Unauthorized edit' WHERE id=load_id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Non-admin could edit a load'; END IF;
  UPDATE public.capacity_loads SET deleted_at=now() WHERE id=load_id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Non-admin could remove a load'; END IF;
  BEGIN
   INSERT INTO public.capacity_loads(pickup,delivery,loading_date,cargo,contact_name,contact_phone)
   VALUES('TEST','TEST',today,'Unauthorized','TEST','00000000');
   RAISE EXCEPTION 'Non-admin could publish a load';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;

 PERFORM set_config('request.jwt.claim.sub',admin2_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin2_id,'role','authenticated')::text,true);
 UPDATE public.capacity_loads SET deleted_at=now() WHERE id=load_id;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_loads WHERE id=load_id AND deleted_at IS NOT NULL AND updated_by=admin2_id) THEN RAISE EXCEPTION 'Second admin cannot remove and retain a load'; END IF;
 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.capacity_loads WHERE id=load_id) THEN RAISE EXCEPTION 'Removed load visible to carrier'; END IF;

 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 UPDATE public.capacity_loads SET deleted_at=NULL,loading_date=today-1 WHERE id=load_id;
 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.capacity_loads WHERE id=load_id) THEN RAISE EXCEPTION 'Past load visible to carrier'; END IF;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 UPDATE public.capacity_loads SET loading_date=today WHERE id=load_id;
 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.capacity_loads WHERE id=load_id) THEN RAISE EXCEPTION 'Republished load not visible'; END IF;

 EXECUTE 'RESET ROLE';
 UPDATE public.capacity_profiles SET approved=false WHERE user_id=carrier_id;
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.capacity_loads WHERE id=load_id) THEN RAISE EXCEPTION 'Revoked carrier still sees loads'; END IF;
 BEGIN
  DELETE FROM public.capacity_loads WHERE id=load_id;
  RAISE EXCEPTION 'Client has hard-delete permission';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 BEGIN
  PERFORM 1 FROM public.capacity_loads;
  RAISE EXCEPTION 'Anonymous read permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'PASS: admin create/edit/remove/restore, both carriers and dispatcher read active loads, no non-admin writes, pending/revoked/anonymous blocked, date hiding, optimistic concurrency and server attribution; all fixtures rolled back' AS result;
