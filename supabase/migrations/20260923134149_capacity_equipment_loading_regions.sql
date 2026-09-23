-- Expand existing choices without rewriting vehicles, bookings or audit history.
ALTER TABLE public.capacity_vehicles
 DROP CONSTRAINT capacity_vehicles_door_type_check,
 ADD CONSTRAINT capacity_vehicles_door_type_check
 CHECK (door_type IN ('Bakdører','Sideåpning','Sideåpning og bakdører','Åpen semi','Flisbil','Maskinsemi')),
 ADD COLUMN loading_region text CHECK (loading_region IN ('Nord-Norge','Midt-Norge','Sør-Norge','Utlandet'));

-- Keep loading location independent of desired direction. Unknown legacy regions stay NULL.
COMMENT ON COLUMN public.capacity_vehicles.loading_region IS
 'Klar for lasting: Nord-Norge (Nordland, Troms, Finnmark), Midt-Norge (Trøndelag), Sør-Norge (resten), Utlandet. NULL = ikke oppgitt.';

-- Extend the existing dispatcher edit guard to include the new field.
CREATE OR REPLACE FUNCTION private.enforce_capacity_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  IF NEW.door_type IS NULL THEN RAISE EXCEPTION 'Velg dører / tilvalg.' USING ERRCODE='23514'; END IF;
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
    (NEW.carrier,NEW.contact,NEW.phone,NEW.registration,NEW.location,NEW.available_at,NEW.vehicle_type,NEW.door_type,NEW.direction,NEW.comment,NEW.loading_region)
    IS DISTINCT FROM (OLD.carrier,OLD.contact,OLD.phone,OLD.registration,OLD.location,OLD.available_at,OLD.vehicle_type,OLD.door_type,OLD.direction,OLD.comment,OLD.loading_region) THEN
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
$function$
;

-- Append the new column after the existing view columns to keep clients compatible.
CREATE OR REPLACE VIEW public.capacity_vehicle_overview WITH (security_invoker=true) AS
 SELECT id, owner_user_id, carrier, contact, phone, registration, location,
 available_at, vehicle_type, direction, comment, status, reserved_by, reserved_at,
 created_at, updated_at, door_type, reservation_comment, reserved_by_name,
 reserved_by_email, deleted_at, deleted_by,
 deleted_at IS NOT NULL OR (available_at AT TIME ZONE 'Europe/Oslo')::date <
 (statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date AS is_history,
 loading_region
 FROM public.capacity_vehicles;
