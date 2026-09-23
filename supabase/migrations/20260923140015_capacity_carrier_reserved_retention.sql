-- Keep a carrier's reserved vehicles in their own overview through the third
-- full Norwegian calendar day after loading. Staff retain the existing live-market
-- cutoff. Deleted rows always stay in history; the invoker view still enforces RLS.
CREATE OR REPLACE VIEW public.capacity_vehicle_overview WITH (security_invoker=true) AS
 SELECT id, owner_user_id, carrier, contact, phone, registration, location,
 available_at, vehicle_type, direction, comment, status, reserved_by, reserved_at,
 created_at, updated_at, door_type, reservation_comment, reserved_by_name,
 reserved_by_email, deleted_at, deleted_by,
 deleted_at IS NOT NULL OR
 (available_at AT TIME ZONE 'Europe/Oslo')::date <
 (statement_timestamp() AT TIME ZONE 'Europe/Oslo')::date -
 CASE WHEN status='Reservert' AND (SELECT private.capacity_current_role())='carrier' THEN 3 ELSE 0 END
 AS is_history,
 loading_region
 FROM public.capacity_vehicles;
