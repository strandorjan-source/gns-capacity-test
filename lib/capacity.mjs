/** Shared validation and display rules. Authorization is always enforced by RLS. */
export const doorTypes = ['Bakdører', 'Sideåpning', 'Sideåpning og bakdører'];
export const blankVehicle = { carrier: '', contact: '', phone: '', registration: '', location: 'Oslo', date: '', time: '', vehicle_type: 'Termo', door_type: '', direction: 'Nord-Norge', comment: '' };
export const isStaff = p => Boolean(p?.approved && ['admin', 'dispatcher'].includes(p.role));
export const isAdmin = p => Boolean(p?.approved && p.role === 'admin');
export const roleName = r => ({ admin: 'Admin', dispatcher: 'Dispatcher', carrier: 'Transportør' }[r] || r);
export const canDeleteVehicle = (p, userId, row) => !row.deleted_at && (isAdmin(p) || Boolean(p?.approved && p.role === 'carrier' && row.owner_user_id === userId && row.status === 'Ledig' && !row.reserved_by && !row.reserved_at));
export function normalizeRegistration(value) {
  const result = String(value || '').trim().replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{2,16}$/.test(result)) throw new Error('Registreringsnummer må inneholde 2–16 bokstaver eller tall.');
  return result;
}
const oslo = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function osloDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) throw new Error('Velg gyldig dato og klokkeslett.');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  const expected = `${date} ${time}`;
  // Norway uses UTC+1 or UTC+2. Validate by formatting back, rejecting impossible
  // calendar values, the spring clock-change gap, and ambiguous autumn times.
  const matches = [60, 120].map(offset => new Date(nominal - offset * 60000)).filter(d => oslo.format(d) === expected);
  if (!matches.length) throw new Error('Dato eller klokkeslett finnes ikke i norsk tid. Kontroller eventuell overgang til sommertid.');
  if (matches.length > 1) throw new Error('Klokkeslettet forekommer to ganger ved overgang til vintertid. Velg et tidspunkt utenfor kl. 02–03.');
  return matches[0].toISOString();
}
function required(value, label, max = 200) {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new Error(`${label} må fylles ut og kan ha maksimalt ${max} tegn.`);
  return result;
}
export function vehicleChanges(form) {
  if (!['Termo', 'Express', 'Standard', 'Sideåpning'].includes(form.vehicle_type)) throw new Error('Velg en gyldig biltype.');
  if (!doorTypes.includes(form.door_type)) throw new Error('Velg sideåpning eller bakdører.');
  if (String(form.comment || '').length > 2000) throw new Error('Kommentaren kan ha maksimalt 2000 tegn.');
  return {
    carrier: required(form.carrier, 'Transportør'),
    contact: required(form.contact, 'Kontaktperson'), phone: required(form.phone, 'Telefon', 50),
    registration: normalizeRegistration(form.registration), location: required(form.location, 'Sted'),
    available_at: osloDateTime(form.date, form.time), vehicle_type: form.vehicle_type, door_type: form.door_type,
    direction: String(form.direction || '').trim().slice(0, 200), comment: String(form.comment || '').trim(),
  };
}
export function vehiclePayload(form, userId) {
  if (!userId) throw new Error('Du må logge inn på nytt.');
  return { ...vehicleChanges(form), owner_user_id: userId, status: 'Ledig', reserved_by: null, reserved_at: null };
}
export function vehicleForm(row) {
  const [date, time] = oslo.format(new Date(row.available_at)).split(' ');
  return { ...blankVehicle, ...Object.fromEntries(Object.keys(blankVehicle).map(k => [k, row[k] ?? blankVehicle[k]])), date, time };
}
export function osloDate(value = new Date()) { return oslo.format(new Date(value)).slice(0, 10); }
export function isHistorical(row, today = osloDate()) { return Boolean(row.deleted_at || osloDate(row.available_at) < today); }
export function reservationComment(value) {
  const comment = String(value || '').trim();
  if (comment.length > 2000) throw new Error('Lasskommentaren kan ha maksimalt 2000 tegn.');
  return comment || null;
}
export const eventName = action => ({ registered: 'Bil meldt inn', reserved: 'Reservert', released: 'Frigitt', edited: 'Bil redigert', deleted: 'Linje slettet', restored: 'Linje gjenopprettet', reservation_imported: 'Tidligere reservasjon' }[action] || action);
export const vehicleLabels = { carrier: 'Transportør', contact: 'Kontaktperson', phone: 'Telefon', registration: 'Reg.nr', location: 'Sted', available_at: 'Ledig fra', vehicle_type: 'Biltype', door_type: 'Dører', direction: 'Retning', comment: 'Kommentar' };
export function formatDate(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return ['Ikke angitt', ''];
  return [new Intl.DateTimeFormat('nb-NO', { dateStyle: 'short', timeZone: 'Europe/Oslo' }).format(date), new Intl.DateTimeFormat('nb-NO', { timeStyle: 'short', timeZone: 'Europe/Oslo' }).format(date)];
}
export function authErrorFromUrl(href) {
  const url = new URL(href);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const code = query.get('error_code') || query.get('error') || hash.get('error_code') || hash.get('error');
  const description = query.get('error_description') || hash.get('error_description');
  if (!code && !description) return '';
  // Do not display or log the raw provider description: it can contain auth codes.
  if (code === 'access_denied') return 'Microsoft-innloggingen ble avbrutt eller avvist. Prøv igjen med riktig konto.';
  return 'Microsoft-innloggingen kunne ikke fullføres. Prøv igjen. Ved gjentatt feil må GNS kontrollere Microsoft-oppsettet og returadressen i Supabase.';
}
export function userMessage(error) {
  if (/unable to exchange external code/i.test(error?.message || '')) return 'Microsoft-innloggingen feilet. GNS må kontrollere Microsoft-oppsettet i Supabase.';
  if (error?.code === '23505') return 'Dette registreringsnummeret er allerede meldt inn denne datoen. Rediger den eksisterende linjen, eller velg en annen dato.';
  if (error?.code === '42501') return 'Handlingen er ikke tillatt for din bruker. Oppdater oversikten og kontroller godkjenningen.';
  return error?.message || 'Handlingen mislyktes. Prøv igjen.';
}
export async function withTimeout(promise, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tilkoblingen tok for lang tid. Kontroller nettet og prøv igjen.')), milliseconds); })]);
  } finally { clearTimeout(timer); }
}
