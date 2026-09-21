-- Transportører kan redigere egne biler, også reserverte biler.
-- Existing trigger keeps ownership, reservation data, and deletion rules protected.
ALTER POLICY capacity_vehicles_owner_update ON public.capacity_vehicles
 USING (
  owner_user_id = (SELECT auth.uid())
  AND (SELECT private.capacity_current_role()) = 'carrier'
  AND deleted_at IS NULL
 )
 WITH CHECK (
  owner_user_id = (SELECT auth.uid())
  AND (SELECT private.capacity_current_role()) = 'carrier'
 );
