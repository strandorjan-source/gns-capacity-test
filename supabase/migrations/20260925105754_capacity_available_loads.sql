-- Independent load board: approved carriers/dispatchers read active loads;
-- only approved Capacity admins create, edit, remove or restore them.
CREATE TABLE public.capacity_loads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pickup text NOT NULL CHECK (char_length(btrim(pickup)) BETWEEN 1 AND 200),
 delivery text NOT NULL CHECK (char_length(btrim(delivery)) BETWEEN 1 AND 200),
 loading_date date NOT NULL,
 loading_time time(0),
 delivery_date date CHECK (delivery_date IS NULL OR delivery_date >= loading_date),
 cargo text NOT NULL CHECK (char_length(btrim(cargo)) BETWEEN 1 AND 300),
 vehicle_requirements text NOT NULL DEFAULT '' CHECK (char_length(vehicle_requirements) <= 200),
 contact_name text NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 1 AND 200),
 contact_phone text NOT NULL CHECK (char_length(btrim(contact_phone)) BETWEEN 1 AND 50),
 comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 2000),
 created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 updated_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deleted_at timestamptz
);
ALTER TABLE public.capacity_loads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capacity_loads FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.capacity_loads TO authenticated;

CREATE POLICY capacity_loads_read ON public.capacity_loads FOR SELECT TO authenticated USING (
 (SELECT private.capacity_current_role())='admin'
 OR ((SELECT private.capacity_current_role()) IN ('carrier','dispatcher')
  AND deleted_at IS NULL
  AND loading_date >= (statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date)
);
CREATE POLICY capacity_loads_admin_insert ON public.capacity_loads FOR INSERT TO authenticated
 WITH CHECK ((SELECT private.capacity_current_role())='admin' AND created_by=(SELECT auth.uid()));
CREATE POLICY capacity_loads_admin_update ON public.capacity_loads FOR UPDATE TO authenticated
 USING ((SELECT private.capacity_current_role())='admin')
 WITH CHECK ((SELECT private.capacity_current_role())='admin');

CREATE INDEX capacity_loads_active_date_idx ON public.capacity_loads(loading_date,id) WHERE deleted_at IS NULL;
CREATE INDEX capacity_loads_created_by_idx ON public.capacity_loads(created_by);
CREATE INDEX capacity_loads_updated_by_idx ON public.capacity_loads(updated_by);

CREATE FUNCTION private.enforce_capacity_load()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR (SELECT private.capacity_current_role()) IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'Bare godkjent admin kan publisere og endre lass.' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.created_by:=auth.uid(); NEW.created_at:=clock_timestamp(); NEW.deleted_at:=NULL;
 ELSE
  IF (NEW.id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'Lassets identitet og opprinnelige registrering kan ikke endres.' USING ERRCODE='42501';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
   NEW.deleted_at:=clock_timestamp();
  END IF;
 END IF;
 NEW.pickup:=btrim(NEW.pickup); NEW.delivery:=btrim(NEW.delivery);
 NEW.cargo:=btrim(NEW.cargo); NEW.vehicle_requirements:=btrim(NEW.vehicle_requirements);
 NEW.contact_name:=btrim(NEW.contact_name); NEW.contact_phone:=btrim(NEW.contact_phone);
 NEW.comment:=btrim(NEW.comment);
 NEW.updated_by:=auth.uid(); NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_capacity_load() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_capacity_load BEFORE INSERT OR UPDATE ON public.capacity_loads
 FOR EACH ROW EXECUTE FUNCTION private.enforce_capacity_load();
COMMENT ON TABLE public.capacity_loads IS 'Ledige lass publisert av Capacity-admin for godkjente transportører. Fjernes med deleted_at; ingen klienttilgang til fysisk sletting.';
