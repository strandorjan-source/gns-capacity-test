export function cargoOrderUrl(vehicle) {
  if (!vehicle?.id || !vehicle.reserved_at) throw new Error('Reservasjonen må lagres før Cargo kan åpnes.');
  const url = new URL('https://gnscargo.vercel.app/app-fixed.html');
  url.searchParams.set('capacity_vehicle', vehicle.id);
  url.searchParams.set('capacity_reservation', vehicle.reserved_at);
  return url.href;
}

// Send only a reservation identity. Cargo retrieves authorized data from Supabase.
export function openCargoOrder(vehicle, browser = window) {
  const href = cargoOrderUrl(vehicle);
  if (browser.parent !== browser && browser.location.origin === new URL(href).origin) {
    browser.parent.postMessage({ type: 'gns-capacity-new-order', vehicleId: vehicle.id, reservedAt: vehicle.reserved_at }, browser.location.origin);
  } else browser.location.assign(href);
  return href;
}
