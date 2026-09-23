'use client';
import { useEffect, useRef } from 'react';
import { doorTypes, loadingRegions, isAdmin, isStaff, canDeleteVehicle, canEditVehicle, dateOptionLabel, formatDate, eventName, vehicleLabels } from '../lib/capacity.mjs';

export function CapacityFilters({ history, dates, date, onDate, status, onStatus, counts, region = '', onRegion }) {
  // Keep the selected day visible if the final vehicle is moved or deleted live.
  const options = [...new Set([...dates, ...(date ? [date] : [])])].sort();
  if (history) options.reverse();
  function tabKeys(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'Ledig' : event.key === 'End' ? 'Reservert' : status === 'Ledig' ? 'Reservert' : 'Ledig';
    onStatus(next);
    event.currentTarget.parentElement.querySelector(next === 'Ledig' ? '#tab-available' : '#tab-reserved')?.focus();
  }
  return <div className="capacity-filters">
    {!history && <div className="status-tabs" role="tablist" aria-label="Bilstatus">
      {[['Ledig', 'Ledige biler', 'available'], ['Reservert', 'Reserverte biler', 'reserved']].map(([value, label, id]) => <button key={value} id={`tab-${id}`} type="button" role="tab" aria-selected={status === value} aria-controls="vehicle-results" tabIndex={status === value ? 0 : -1} className={status === value ? `selected ${id}` : ''} onClick={() => onStatus(value)} onKeyDown={tabKeys}>{label}<span>{counts[value] || 0}</span></button>)}
    </div>}
    <label className="date-filter region-filter">Klar for lasting i<select value={region} onChange={event => onRegion(event.target.value)}><option value="">Alle landsdeler</option>{loadingRegions.map(value => <option key={value}>{value}</option>)}<option value="unknown">Ikke oppgitt</option></select></label>
    <label className="date-filter">Ledigdato<select value={date} onChange={event => onDate(event.target.value)}><option value="">Alle datoer</option>{options.map(day => <option value={day} key={day}>{dateOptionLabel(day)}</option>)}</select></label>
    {date && <button type="button" className="clear-filter" onClick={() => onDate('')}>Vis alle datoer</button>}
  </div>;
}

const Field = ({ label, children }) => <label>{label}{children}</label>;
export function VehicleForm({ form, setForm, onSubmit, busy, submitLabel }) {
  const field = name => ({ value: form[name], onChange: e => setForm(old => ({ ...old, [name]: e.target.value })) });
  return <form onSubmit={onSubmit}>
    <Field label="Transportør / firma"><input required maxLength={200} {...field('carrier')} placeholder="Firmanavn" /></Field>
    <div className="two"><Field label="Kontaktperson"><input required maxLength={200} {...field('contact')} /></Field><Field label="Telefon"><input type="tel" required maxLength={50} {...field('phone')} /></Field></div>
    <div className="two"><Field label="Registreringsnummer"><input required maxLength={24} {...field('registration')} placeholder="F.eks. YN 12345" /></Field><Field label="Hvor er bilen ledig?"><input required maxLength={200} {...field('location')} /></Field></div>
    <Field label="Landsdel klar for lasting"><select required aria-describedby="loading-region-help" {...field('loading_region')}><option value="" disabled>Velg landsdel</option>{loadingRegions.map(region => <option key={region}>{region}</option>)}</select></Field>
    <p className="hint" id="loading-region-help">Nord-Norge: Nordland, Troms og Finnmark. Midt-Norge: Trøndelag. Sør-Norge: resten av Norge.</p>
    <div className="two"><Field label="Dato (norsk tid)"><input type="date" required {...field('date')} /></Field><Field label="Klokkeslett (norsk tid)"><input type="time" required {...field('time')} /></Field></div>
    <div className="two"><Field label="Biltype"><select {...field('vehicle_type')}><option>Termo</option><option>Express</option><option>Standard</option>{form.vehicle_type === 'Sideåpning' && <option>Sideåpning</option>}</select></Field><Field label="Dører / tilvalg"><select required {...field('door_type')}><option value="" disabled>Velg dører / tilvalg</option>{doorTypes.map(type => <option key={type}>{type}</option>)}</select></Field></div>
    <Field label="Ønsket retning"><input maxLength={200} {...field('direction')} /></Field>
    <Field label="Kommentar om bilen"><textarea maxLength={2000} {...field('comment')} placeholder="Valgfritt" /></Field>
    <button disabled={busy} className="primary full">{busy ? 'Lagrer …' : submitLabel}</button>
  </form>;
}

export function VehicleTable({ rows, profile, userId, busy, onAction, onEvents }) {
  const admin = isAdmin(profile), staff = isStaff(profile);
  return <div className="table"><table className="vehicle-table"><thead><tr><th>Status</th><th>Transportør</th><th>Reg.nr / sted</th><th>Ledig fra</th><th>Biltype / tilvalg</th><th>Reservasjon / lass</th><th>Handling</th></tr></thead><tbody>
    {rows.map(row => <tr key={row.id} className={row.deleted_at ? 'deleted' : row.status === 'Ledig' ? 'available' : 'reserved'}>
      <td><span className={`pill ${row.deleted_at ? 'slettet' : row.status.toLowerCase()}`}>{row.deleted_at ? 'Slettet' : row.status}</span>{row.is_history && !row.deleted_at && <small>Passert dato</small>}</td>
      <td><b>{row.carrier}</b><small>{row.contact}{row.phone ? ` · ${row.phone}` : ''}</small>{row.comment && <small className="multiline">{row.comment}</small>}</td>
      <td><b>{row.registration}</b><small>{row.location}</small><small className="loading-region">Klar for lasting: {row.loading_region || 'Ikke oppgitt'}</small><small>Retning: {row.direction || '–'}</small></td>
      <td>{formatDate(row.available_at)[0]}<small>kl. {formatDate(row.available_at)[1]}</small></td>
      <td>{row.vehicle_type || '–'}<small className="door-type">{row.door_type || 'Tilvalg: Ikke oppgitt'}</small></td>
      <td className="reservation-cell">{row.status === 'Reservert' ? <><b>{row.reserved_by_name || row.reserved_by_email || 'Ukjent bruker'}</b>{row.reserved_by_email && <small>{row.reserved_by_email}</small>}<small>{formatDate(row.reserved_at).join(' kl. ')}</small><p className="multiline">{row.reservation_comment || 'Ingen lasskommentar registrert'}</p></> : <span className="muted">Ingen aktiv reservasjon</span>}</td>
      <td><div className="actions">
        {staff && !row.deleted_at && (!row.is_history || row.status === 'Reservert') && <button disabled={busy} className="book" onClick={() => onAction(row.status === 'Ledig' ? 'reserve' : 'release', row)}>{row.status === 'Ledig' ? 'Reserver' : 'Frigi'}</button>}
        {canEditVehicle(profile, userId, row) && <button disabled={busy} className="iconButton" onClick={() => onAction('edit', row)}>Rediger</button>}
        {canDeleteVehicle(profile, userId, row) && <button disabled={busy} className="iconButton delete-button" onClick={() => onAction('delete', row)}>Slett</button>}
        {admin && row.deleted_at && <button disabled={busy} className="iconButton" onClick={() => onAction('restore', row)}>Gjenopprett</button>}
        <button className="iconButton" disabled={busy} onClick={() => onEvents(row)}>Hendelser</button>
      </div></td>
    </tr>)}
  </tbody></table></div>;
}

export function Modal({ title, children, busy, onClose, message }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="capacity-dialog formcard" aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button type="button" className="iconButton" disabled={busy} aria-label="Lukk dialog" onClick={onClose}>×</button></div>
    {message && <div role="alert" className="formerror">{message}</div>}
    {children}<button className="link" disabled={busy} onClick={onClose}>Lukk</button>
  </dialog>;
}

export function EventLog({ events, loading }) {
  if (loading) return <p role="status">Laster hendelser …</p>;
  if (!events.length) return <p>Ingen hendelser er registrert ennå. Nye handlinger logges automatisk.</p>;
  return <ol className="event-log">{events.map(event => {
    const snapshot = event.action === 'released' ? event.before_data : event.after_data;
    const changed = event.action === 'edited' ? Object.keys(vehicleLabels).filter(k => event.before_data?.[k] !== event.after_data?.[k]) : [];
    return <li key={event.id}><div><b>{eventName(event.action)}</b><time>{formatDate(event.created_at).join(' kl. ')}</time></div>
      <p>{event.actor_name || event.actor_email || 'Ukjent bruker'}{event.actor_email && event.actor_name ? ` · ${event.actor_email}` : ''}</p>
      {['reserved', 'released', 'reservation_imported'].includes(event.action) && <p className="event-comment multiline">{snapshot?.reservation_comment || 'Ingen lasskommentar registrert'}</p>}
      {changed.length > 0 && <dl>{changed.map(k => <div key={k}><dt>{vehicleLabels[k]}</dt><dd>{displayValue(k, event.before_data?.[k])} → {displayValue(k, event.after_data?.[k])}</dd></div>)}</dl>}
    </li>;
  })}</ol>;
}
function displayValue(key, value) { return key === 'available_at' ? formatDate(value).join(' kl. ') : String(value || 'Ikke oppgitt'); }
