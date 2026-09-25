import { osloDate, osloDateTime } from './capacity.mjs';

export const blankLoad = {
  pickup: '', delivery: '', loading_date: '', loading_time: '', delivery_date: '',
  cargo: '', vehicle_requirements: '', contact_name: '', contact_phone: '', comment: '',
};

function text(value, label, max, required = false) {
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error(`Fyll ut ${label.toLowerCase()}.`);
  if (result.length > max) throw new Error(`${label} kan ha maksimalt ${max} tegn.`);
  return result;
}

export function loadChanges(form) {
  // Noon is unambiguous on all Norwegian calendar days, including DST changes.
  osloDateTime(form.loading_date, '12:00');
  const deliveryDate = form.delivery_date || null;
  if (deliveryDate) {
    osloDateTime(deliveryDate, '12:00');
    if (deliveryDate < form.loading_date) throw new Error('Leveringsdato kan ikke være før lastedato.');
  }
  const time = form.loading_time || null;
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Velg et gyldig klokkeslett.');
  return {
    pickup: text(form.pickup, 'Lastested', 200, true),
    delivery: text(form.delivery, 'Leveringssted', 200, true),
    loading_date: form.loading_date, loading_time: time, delivery_date: deliveryDate,
    cargo: text(form.cargo, 'Gods / omfang', 300, true),
    vehicle_requirements: text(form.vehicle_requirements, 'Bilbehov', 200),
    contact_name: text(form.contact_name, 'Kontaktperson', 200, true),
    contact_phone: text(form.contact_phone, 'Telefon', 50, true),
    comment: text(form.comment, 'Kommentar', 2000),
  };
}

export function loadForm(row) {
  return { ...blankLoad, ...Object.fromEntries(Object.keys(blankLoad).map(key => [key, row[key] ?? ''])), loading_time: row.loading_time?.slice(0, 5) || '' };
}
export function isCurrentLoad(row, today = osloDate()) { return !row.deleted_at && row.loading_date >= today; }
export function loadDateLabel(value) {
  return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date(`${value}T12:00:00Z`));
}
