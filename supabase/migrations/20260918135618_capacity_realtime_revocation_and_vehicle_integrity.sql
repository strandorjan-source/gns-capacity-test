-- Scope: GNS Capacity only; existing order tables are unchanged.
REVOKE ALL ON public.capacity_profiles, public.capacity_vehicles FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.capacity_profiles, public.capacity_vehicles FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.capacity_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_vehicles TO authenticated;

ALTER POLICY capacity_vehicles_select ON public.capacity_vehicles TO authenticated
USING ((SELECT private.capacity_current_role()) IS NOT NULL AND
 (owner_user_id = (SELECT auth.uid()) OR (SELECT private.capacity_current_role()) IN ('admin','dispatcher')));

CREATE UNIQUE INDEX IF NOT EXISTS capacity_vehicles_registration_normalized_key
 ON public.capacity_vehicles (upper(regexp_replace(registration, '[[:space:]-]+', '', 'g')));
CREATE INDEX IF NOT EXISTS capacity_vehicles_available_at_idx ON public.capacity_vehicles(available_at);
CREATE INDEX IF NOT EXISTS capacity_vehicles_reserved_by_idx ON public.capacity_vehicles(reserved_by) WHERE reserved_by IS NOT NULL;

CREATE OR REPLACE FUNCTION private.enforce_capacity_profile_privilege()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF (NEW.user_id, NEW.email, NEW.created_at) IS DISTINCT FROM (OLD.user_id, OLD.email, OLD.created_at) THEN
  RAISE EXCEPTION 'Profile identity cannot be changed' USING ERRCODE='42501';
 END IF;
 IF (NEW.role, NEW.approved) IS DISTINCT FROM (OLD.role, OLD.approved) THEN
  IF coalesce((SELECT private.capacity_current_role()),'') <> 'admin' THEN
   RAISE EXCEPTION 'Only an administrator can change role or approval' USING ERRCODE='42501';
  END IF;
  IF OLD.user_id = auth.uid() THEN
   RAISE EXCEPTION 'An administrator cannot remove their own access or change their own role' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_capacity_reservation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE actor_role text;
BEGIN
 NEW.registration := upper(regexp_replace(btrim(NEW.registration), '[[:space:]-]+', '', 'g'));
 IF NEW.registration !~ '^[A-Z0-9]{2,16}$' THEN
  RAISE EXCEPTION 'Registration must contain 2-16 letters or digits' USING ERRCODE='23514';
 END IF;
 IF char_length(btrim(NEW.carrier)) NOT BETWEEN 1 AND 200 OR char_length(btrim(NEW.location)) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Carrier and location are required (maximum 200 characters)' USING ERRCODE='23514';
 END IF;
 NEW.carrier := btrim(NEW.carrier);
 NEW.location := btrim(NEW.location);
 IF TG_OP = 'UPDATE' THEN
  IF (NEW.id, NEW.owner_user_id, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.owner_user_id, OLD.created_at) THEN
   RAISE EXCEPTION 'Vehicle identity and owner cannot be changed' USING ERRCODE='42501';
  END IF;
  IF (NEW.status, NEW.reserved_by, NEW.reserved_at) IS DISTINCT FROM (OLD.status, OLD.reserved_by, OLD.reserved_at) THEN
   actor_role := (SELECT private.capacity_current_role());
   IF coalesce(actor_role,'') NOT IN ('admin','dispatcher') THEN
    RAISE EXCEPTION 'Only GNS can reserve or release vehicles' USING ERRCODE='42501';
   END IF;
   IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Reservation details cannot be changed without a status change' USING ERRCODE='42501';
   END IF;
   IF NEW.status = 'Reservert' THEN NEW.reserved_by := auth.uid(); NEW.reserved_at := clock_timestamp();
   ELSE NEW.reserved_by := NULL; NEW.reserved_at := NULL; END IF;
  END IF;
 END IF;
 NEW.updated_at := clock_timestamp();
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_capacity_reservation ON public.capacity_vehicles;
CREATE TRIGGER enforce_capacity_reservation BEFORE INSERT OR UPDATE ON public.capacity_vehicles
FOR EACH ROW EXECUTE FUNCTION private.enforce_capacity_reservation();

ALTER TABLE public.capacity_vehicles ADD CONSTRAINT capacity_vehicle_reservation_consistent
CHECK ((status='Ledig' AND reserved_by IS NULL AND reserved_at IS NULL) OR
       (status='Reservert' AND reserved_by IS NOT NULL AND reserved_at IS NOT NULL));

REVOKE ALL ON FUNCTION private.enforce_capacity_profile_privilege() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.enforce_capacity_reservation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_capacity_profile_privilege(), private.enforce_capacity_reservation() TO authenticated;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='capacity_vehicles') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.capacity_vehicles;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='capacity_profiles') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.capacity_profiles;
 END IF;
END $$;
