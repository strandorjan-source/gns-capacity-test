-- Capacity only. Preserve every existing vehicle and reservation.
ALTER TABLE public.capacity_vehicles
 ADD COLUMN door_type text CHECK (door_type IN ('Bakdører','Sideåpning','Sideåpning og bakdører')),
 ADD COLUMN reservation_comment text CHECK (char_length(reservation_comment) <= 2000),
 ADD COLUMN reserved_by_name text,
 ADD COLUMN reserved_by_email text,
 ADD COLUMN deleted_at timestamptz,
 ADD COLUMN deleted_by uuid;

-- Old rows do not imply a door type. Only a previously explicit side opening is known.
UPDATE public.capacity_vehicles SET door_type='Sideåpning' WHERE vehicle_type='Sideåpning';
UPDATE public.capacity_vehicles v
 SET reserved_by_name=coalesce(nullif(btrim(p.full_name),''),p.email), reserved_by_email=p.email
 FROM public.capacity_profiles p WHERE p.user_id=v.reserved_by;

-- A plate may return on another date; duplicates on the same Norwegian day are rejected.
DROP INDEX public.capacity_vehicles_owner_registration_key;
DROP INDEX public.capacity_vehicles_registration_normalized_key;
CREATE UNIQUE INDEX capacity_vehicles_registration_day_key
 ON public.capacity_vehicles (registration, ((available_at AT TIME ZONE 'Europe/Oslo')::date))
 WHERE deleted_at IS NULL;
CREATE INDEX capacity_vehicles_owner_idx ON public.capacity_vehicles(owner_user_id);

CREATE TABLE public.capacity_vehicle_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 actor_id uuid,
 actor_name text,
 actor_email text,
 action text NOT NULL CHECK (action IN ('registered','reserved','released','edited','deleted','restored','reservation_imported')),
 before_data jsonb,
 after_data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX capacity_vehicle_events_vehicle_idx ON public.capacity_vehicle_events(vehicle_id,created_at DESC,id DESC);
CREATE INDEX capacity_vehicle_events_owner_idx ON public.capacity_vehicle_events(owner_user_id);
ALTER TABLE public.capacity_vehicle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capacity_vehicle_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.capacity_vehicle_events TO authenticated;
CREATE POLICY capacity_events_select ON public.capacity_vehicle_events FOR SELECT TO authenticated
 USING ((SELECT private.capacity_current_role()) IS NOT NULL AND
 (owner_user_id=(SELECT auth.uid()) OR (SELECT private.capacity_current_role()) IN ('admin','dispatcher')));

-- Import only facts that exist: original actor/time, with no invented historical comment.
INSERT INTO public.capacity_vehicle_events(vehicle_id,owner_user_id,actor_id,actor_name,actor_email,action,after_data,created_at)
 SELECT id,owner_user_id,reserved_by,reserved_by_name,reserved_by_email,'reservation_imported',to_jsonb(v),reserved_at
 FROM public.capacity_vehicles v WHERE status='Reservert';

CREATE OR REPLACE FUNCTION private.enforce_capacity_reservation()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor_role text;
BEGIN
 actor_role := (SELECT private.capacity_current_role());
 IF auth.uid() IS NULL OR actor_role IS NULL THEN
  RAISE EXCEPTION 'Du må være innlogget og godkjent.' USING ERRCODE='42501';
 END IF;
 NEW.registration := upper(regexp_replace(btrim(NEW.registration),'[[:space:]-]+','','g'));
 IF NEW.registration !~ '^[A-Z0-9]{2,16}$' THEN
  RAISE EXCEPTION 'Registreringsnummer må inneholde 2–16 bokstaver eller tall.' USING ERRCODE='23514';
 END IF;
 NEW.carrier:=btrim(NEW.carrier); NEW.location:=btrim(NEW.location);
 IF char_length(NEW.carrier) NOT BETWEEN 1 AND 200 OR char_length(NEW.location) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Transportør og sted må fylles ut (maks 200 tegn).' USING ERRCODE='23514';
 END IF;
 IF coalesce(char_length(NEW.comment),0)>2000 OR coalesce(char_length(NEW.contact),0)>200 OR coalesce(char_length(NEW.phone),0)>50 OR coalesce(char_length(NEW.direction),0)>200 THEN
  RAISE EXCEPTION 'Et av feltene inneholder for mange tegn.' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.door_type IS NULL THEN RAISE EXCEPTION 'Velg sideåpning eller bakdører.' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'Ledig' OR NEW.deleted_at IS NOT NULL THEN
   RAISE EXCEPTION 'Nye biler skal meldes inn som ledige.' USING ERRCODE='42501';
  END IF;
  NEW.reserved_by:=NULL; NEW.reserved_at:=NULL; NEW.reserved_by_name:=NULL; NEW.reserved_by_email:=NULL;
  NEW.reservation_comment:=NULL; NEW.deleted_by:=NULL;
 ELSE
  IF (NEW.id,NEW.owner_user_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.owner_user_id,OLD.created_at) THEN
   RAISE EXCEPTION 'Bilens identitet og eier kan ikke endres.' USING ERRCODE='42501';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NOT (actor_role='admin' AND NEW.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'Slettede linjer må gjenopprettes av admin før redigering.' USING ERRCODE='42501';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
   IF actor_role<>'admin' AND NOT (actor_role='carrier' AND OLD.owner_user_id=auth.uid() AND OLD.status='Ledig' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Du kan ikke slette eller gjenopprette denne linjen.' USING ERRCODE='42501';
   END IF;
   IF (to_jsonb(NEW)-ARRAY['deleted_at','deleted_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['deleted_at','deleted_by','updated_at']) THEN
    RAISE EXCEPTION 'Sletting og gjenoppretting må utføres separat fra andre endringer.' USING ERRCODE='23514';
   END IF;
   IF NEW.deleted_at IS NOT NULL THEN NEW.deleted_at:=clock_timestamp(); NEW.deleted_by:=auth.uid();
   ELSE NEW.deleted_by:=NULL; END IF;
  ELSIF NEW.deleted_by IS DISTINCT FROM OLD.deleted_by THEN
   RAISE EXCEPTION 'Slettehistorikken kan ikke endres.' USING ERRCODE='42501';
  END IF;
  IF actor_role='dispatcher' AND
    (NEW.carrier,NEW.contact,NEW.phone,NEW.registration,NEW.location,NEW.available_at,NEW.vehicle_type,NEW.door_type,NEW.direction,NEW.comment)
    IS DISTINCT FROM (OLD.carrier,OLD.contact,OLD.phone,OLD.registration,OLD.location,OLD.available_at,OLD.vehicle_type,OLD.door_type,OLD.direction,OLD.comment) THEN
   RAISE EXCEPTION 'Bare admin kan redigere andre transportørers biler.' USING ERRCODE='42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF actor_role NOT IN ('admin','dispatcher') OR OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bare GNS kan reservere og frigi biler.' USING ERRCODE='42501';
   END IF;
   IF NEW.status='Reservert' THEN
    IF (NEW.available_at AT TIME ZONE 'Europe/Oslo')::date < (statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date THEN
     RAISE EXCEPTION 'Ledigdatoen er passert. Oppdater datoen før du reserverer bilen.' USING ERRCODE='23514';
    END IF;
    NEW.reserved_by:=auth.uid(); NEW.reserved_at:=clock_timestamp();
    SELECT coalesce(nullif(btrim(p.full_name),''),p.email),p.email INTO NEW.reserved_by_name,NEW.reserved_by_email
     FROM public.capacity_profiles p WHERE p.user_id=auth.uid();
    NEW.reservation_comment:=nullif(btrim(NEW.reservation_comment),'');
   ELSE
    NEW.reserved_by:=NULL; NEW.reserved_at:=NULL; NEW.reserved_by_name:=NULL; NEW.reserved_by_email:=NULL; NEW.reservation_comment:=NULL;
   END IF;
  ELSIF (NEW.reserved_by,NEW.reserved_at,NEW.reserved_by_name,NEW.reserved_by_email,NEW.reservation_comment)
   IS DISTINCT FROM (OLD.reserved_by,OLD.reserved_at,OLD.reserved_by_name,OLD.reserved_by_email,OLD.reservation_comment) THEN
   RAISE EXCEPTION 'Reservasjonens bruker, tidspunkt og kommentar kan ikke overskrives.' USING ERRCODE='42501';
  END IF;
 END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END;
$$;

-- An internal trigger is the sole audit writer. Clients cannot forge, edit or delete events.
CREATE FUNCTION private.audit_capacity_vehicle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_action text; actor_name text; actor_email text;
BEGIN
 IF auth.uid() IS NULL OR (SELECT private.capacity_current_role()) IS NULL THEN
  RAISE EXCEPTION 'Authenticated approved actor required' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(nullif(btrim(p.full_name),''),p.email),p.email INTO actor_name,actor_email
  FROM public.capacity_profiles p WHERE p.user_id=auth.uid();
 IF TG_OP='INSERT' THEN event_action:='registered';
 ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN event_action:='deleted';
 ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN event_action:='restored';
 ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
  event_action:=CASE WHEN NEW.status='Reservert' THEN 'reserved' ELSE 'released' END;
 ELSIF (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN event_action:='edited';
 ELSE RETURN NEW;
 END IF;
 INSERT INTO public.capacity_vehicle_events(vehicle_id,owner_user_id,actor_id,actor_name,actor_email,action,before_data,after_data)
 VALUES(NEW.id,NEW.owner_user_id,auth.uid(),actor_name,actor_email,event_action,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.audit_capacity_vehicle() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_capacity_vehicle AFTER INSERT OR UPDATE ON public.capacity_vehicles
 FOR EACH ROW EXECUTE FUNCTION private.audit_capacity_vehicle();

-- Deletion through the app is recoverable and audited; no client may physically delete a row.
REVOKE DELETE ON public.capacity_vehicles FROM authenticated;
DROP POLICY capacity_vehicles_delete ON public.capacity_vehicles;
ALTER POLICY capacity_vehicles_owner_update ON public.capacity_vehicles
 USING (owner_user_id=(SELECT auth.uid()) AND (SELECT private.capacity_current_role())='carrier'
 AND status='Ledig' AND reserved_by IS NULL AND reserved_at IS NULL AND deleted_at IS NULL)
 WITH CHECK (owner_user_id=(SELECT auth.uid()) AND (SELECT private.capacity_current_role())='carrier'
 AND status='Ledig' AND reserved_by IS NULL AND reserved_at IS NULL);

-- The database's Norwegian date is authoritative, even on devices in another time zone.
CREATE VIEW public.capacity_vehicle_overview WITH (security_invoker=true) AS
 SELECT v.*, (v.deleted_at IS NOT NULL OR (v.available_at AT TIME ZONE 'Europe/Oslo')::date <
 (statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date) AS is_history
 FROM public.capacity_vehicles v;
REVOKE ALL ON public.capacity_vehicle_overview FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.capacity_vehicle_overview TO authenticated;
