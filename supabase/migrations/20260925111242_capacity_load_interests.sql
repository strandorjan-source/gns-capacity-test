-- One durable interest per carrier account and load; withdrawal retains the row.
CREATE TABLE public.capacity_load_interests (
 load_id uuid NOT NULL REFERENCES public.capacity_loads(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.capacity_profiles(user_id) ON DELETE CASCADE,
 interested boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (load_id,user_id)
);
ALTER TABLE public.capacity_load_interests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capacity_load_interests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.capacity_load_interests TO authenticated;
CREATE INDEX capacity_load_interests_user_idx ON public.capacity_load_interests(user_id,load_id);

CREATE POLICY capacity_load_interests_read ON public.capacity_load_interests FOR SELECT TO authenticated USING (
 (SELECT private.capacity_current_role())='admin'
 OR ((SELECT private.capacity_current_role())='carrier' AND user_id=(SELECT auth.uid()))
);
CREATE POLICY capacity_load_interests_insert ON public.capacity_load_interests FOR INSERT TO authenticated WITH CHECK (
 (SELECT private.capacity_current_role())='carrier' AND user_id=(SELECT auth.uid()) AND interested
 AND EXISTS (SELECT 1 FROM public.capacity_loads l WHERE l.id=load_id AND l.deleted_at IS NULL
  AND l.loading_date >= (statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date)
);
CREATE POLICY capacity_load_interests_update ON public.capacity_load_interests FOR UPDATE TO authenticated
 USING ((SELECT private.capacity_current_role())='carrier' AND user_id=(SELECT auth.uid()))
 WITH CHECK ((SELECT private.capacity_current_role())='carrier' AND user_id=(SELECT auth.uid())
  AND (NOT interested OR EXISTS (SELECT 1 FROM public.capacity_loads l WHERE l.id=load_id AND l.deleted_at IS NULL
   AND l.loading_date >= (statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date)));

CREATE FUNCTION private.enforce_capacity_load_interest()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR (SELECT private.capacity_current_role()) IS DISTINCT FROM 'carrier'
  OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Bare godkjente transportører kan melde egen interesse.' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.created_at:=clock_timestamp();
 ELSIF (NEW.load_id,NEW.user_id,NEW.created_at) IS DISTINCT FROM (OLD.load_id,OLD.user_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Interessen kan ikke flyttes til et annet lass eller en annen bruker.' USING ERRCODE='42501';
 END IF;
 IF NEW.interested AND NOT EXISTS (
  SELECT 1 FROM public.capacity_loads l WHERE l.id=NEW.load_id AND l.deleted_at IS NULL
   AND l.loading_date >= (statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date
 ) THEN
  RAISE EXCEPTION 'Lasset er ikke lenger tilgjengelig. Oppdater oversikten.' USING ERRCODE='23514';
 END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_capacity_load_interest() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_capacity_load_interest BEFORE INSERT OR UPDATE ON public.capacity_load_interests
 FOR EACH ROW EXECUTE FUNCTION private.enforce_capacity_load_interest();
COMMENT ON TABLE public.capacity_load_interests IS 'Interesse meldt av transportører. Admin ser alle, transportører bare sin egen. Ingen reservasjon eller tildeling av lass.';
