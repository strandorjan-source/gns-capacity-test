-- Actual RLS and profile joins; all identities, loads and interests roll back.
BEGIN;
DO $$
#variable_conflict use_variable
DECLARE
 admin_id uuid:=gen_random_uuid(); carrier_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
 pending_id uuid:=gen_random_uuid(); dispatcher_id uuid:=gen_random_uuid(); actor uuid;
 load_id uuid:=gen_random_uuid(); past_id uuid:=gen_random_uuid(); gone_id uuid:=gen_random_uuid();
 today date:=(statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date;
 affected int; original_update timestamptz;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data)
 SELECT id,id::text||'@capacity-interest-test.invalid','{}'::jsonb
 FROM unnest(ARRAY[admin_id,carrier_id,other_id,pending_id,dispatcher_id]) id;
 INSERT INTO public.capacity_profiles(user_id,email,full_name,company,role,approved)
 SELECT id,id::text||'@capacity-interest-test.invalid','Interest Tester','Test Carrier',
 CASE WHEN id=admin_id THEN 'admin' WHEN id=dispatcher_id THEN 'dispatcher' ELSE 'carrier' END,id<>pending_id
 FROM unnest(ARRAY[admin_id,carrier_id,other_id,pending_id,dispatcher_id]) id
 ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,approved=excluded.approved,company=excluded.company;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 INSERT INTO public.capacity_loads(id,pickup,delivery,loading_date,cargo,contact_name,contact_phone)
 VALUES(load_id,'TEST','TEST',today,'TEST','TEST','00000000'),
 (past_id,'TEST','TEST',today-1,'TEST','TEST','00000000'),
 (gone_id,'TEST','TEST',today,'TEST','TEST','00000000');
 UPDATE public.capacity_loads SET deleted_at=now() WHERE id=gone_id;

 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 INSERT INTO public.capacity_load_interests(load_id,user_id,created_at,updated_at) VALUES(load_id,carrier_id,'2000-01-01','2000-01-01');
 IF NOT EXISTS(SELECT 1 FROM public.capacity_load_interests i WHERE i.load_id=load_id AND i.user_id=carrier_id AND i.interested AND i.created_at>'2000-01-01' AND i.updated_at>'2000-01-01') THEN
  RAISE EXCEPTION 'Interest or trusted timestamps not saved';
 END IF;
 SELECT i.updated_at INTO original_update FROM public.capacity_load_interests i WHERE i.load_id=load_id AND i.user_id=carrier_id;
 BEGIN
  INSERT INTO public.capacity_load_interests(load_id,user_id) VALUES(load_id,carrier_id);
  RAISE EXCEPTION 'Duplicate interest accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  INSERT INTO public.capacity_load_interests(load_id,user_id) VALUES(load_id,other_id);
  RAISE EXCEPTION 'Carrier impersonation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 FOREACH actor IN ARRAY ARRAY[past_id,gone_id] LOOP
  BEGIN
   INSERT INTO public.capacity_load_interests(load_id,user_id) VALUES(actor,carrier_id);
   RAISE EXCEPTION 'Unavailable load accepted interest';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
 END LOOP;
 UPDATE public.capacity_load_interests i SET interested=false WHERE i.load_id=load_id AND i.user_id=carrier_id AND i.updated_at=original_update;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Withdrawal failed'; END IF;
 UPDATE public.capacity_load_interests i SET interested=true WHERE i.load_id=load_id AND i.user_id=carrier_id AND i.updated_at=original_update;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Stale interest overwrite accepted'; END IF;
 UPDATE public.capacity_load_interests i SET interested=true WHERE i.load_id=load_id AND i.user_id=carrier_id;

 PERFORM set_config('request.jwt.claim.sub',other_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',other_id,'role','authenticated')::text,true);
 IF EXISTS(SELECT 1 FROM public.capacity_load_interests i WHERE i.load_id=load_id) THEN RAISE EXCEPTION 'Other carrier sees interest'; END IF;
 UPDATE public.capacity_load_interests i SET interested=false WHERE i.load_id=load_id AND i.user_id=carrier_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Other carrier can withdraw interest'; END IF;
 INSERT INTO public.capacity_load_interests(load_id,user_id) VALUES(load_id,other_id);
 SELECT count(*) INTO affected FROM public.capacity_load_interests i JOIN public.capacity_profiles p ON p.user_id=i.user_id WHERE i.load_id=load_id;
 IF affected<>1 THEN RAISE EXCEPTION 'Carrier profile embedding leaks another interest'; END IF;

 FOREACH actor IN ARRAY ARRAY[admin_id,pending_id,dispatcher_id] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
  SELECT count(*) INTO affected FROM public.capacity_load_interests i JOIN public.capacity_profiles p ON p.user_id=i.user_id
   WHERE i.load_id=load_id AND i.interested AND p.company='Test Carrier';
  IF affected<>(CASE WHEN actor=admin_id THEN 2 ELSE 0 END) THEN RAISE EXCEPTION 'Interest read permissions failed'; END IF;
  BEGIN
   INSERT INTO public.capacity_load_interests(load_id,user_id) VALUES(load_id,actor);
   RAISE EXCEPTION 'Non-carrier can express interest';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
 END LOOP;

 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 UPDATE public.capacity_loads SET deleted_at=now() WHERE id=load_id;
 PERFORM set_config('request.jwt.claim.sub',carrier_id::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',carrier_id,'role','authenticated')::text,true);
 UPDATE public.capacity_load_interests i SET interested=false WHERE i.load_id=load_id AND i.user_id=carrier_id;
 IF NOT EXISTS(SELECT 1 FROM public.capacity_load_interests i WHERE i.load_id=load_id AND i.user_id=carrier_id AND NOT i.interested) THEN RAISE EXCEPTION 'Cannot withdraw interest after load closes'; END IF;
 BEGIN
  UPDATE public.capacity_load_interests i SET interested=true WHERE i.load_id=load_id AND i.user_id=carrier_id;
  RAISE EXCEPTION 'Closed load accepted renewed interest';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 EXECUTE 'RESET ROLE';
 UPDATE public.capacity_profiles SET approved=false WHERE user_id=carrier_id;
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.capacity_load_interests i WHERE i.load_id=load_id) THEN RAISE EXCEPTION 'Revoked carrier still reads interests'; END IF;
 EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE anon';
 BEGIN
  PERFORM 1 FROM public.capacity_load_interests;
  RAISE EXCEPTION 'Anonymous interest access';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 EXECUTE 'RESET ROLE';
END;
$$;
ROLLBACK;
SELECT 'PASS: interest, withdrawal, renewal, duplicate prevention, admin profile details, carrier isolation, unavailable loads, unauthorized roles and trusted timestamps; all fixtures rolled back' AS result;
