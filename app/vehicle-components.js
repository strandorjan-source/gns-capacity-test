'use client';
import { useI18n } from './i18n-provider';
import { useEffect, useRef } from 'react';
import { doorTypes, loadingRegions, vehicleTypeTabs, isAdmin, isStaff, canDeleteVehicle, canEditVehicle, dateOptionLabel, formatDate, eventName, vehicleLabels } from '../lib/capacity.mjs';

export function CapacityStatusTabs({ status, onStatus, counts = {}, ownOverview = false, panelId = 'vehicle-results' }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  const tabs = [...(ownOverview ? [['Alle', 'Alle mine biler', 'mine']] : []), ['Ledig', 'Ledige biler', 'available'], ['Reservert', 'Reserverte biler', 'reserved'], ['Lass', 'Ledige lass', 'loads']];
  function tabKeys(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex(([value]) => value === status);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onStatus(tabs[next][0]);
    // The load board mounts a new tab group; restore keyboard focus after navigation.
    requestAnimationFrame(() => document.getElementById(`tab-${tabs[next][2]}`)?.focus());
  }
  return <div className="status-tabs" role="tablist" aria-label={_t("Kapasitetsoversikt")}>
    {tabs.map(([value, label, id]) => <button key={value} id={`tab-${id}`} type="button" role="tab" aria-selected={status === value} aria-controls={panelId} tabIndex={status === value ? 0 : -1} className={status === value ? `selected ${id}` : ''} onClick={() => onStatus(value)} onKeyDown={tabKeys}>{_t(label)}{value !== 'Lass' && <span>{counts[value] || 0}</span>}</button>)}
  </div>;
}

export function CapacityFilters({ history, dates, date, onDate, status, onStatus, counts, region = '', onRegion, ownOverview = false }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  // Keep the selected day visible if the final vehicle is moved or deleted live.
  const options = [...new Set([...dates, ...(date ? [date] : [])])].sort();
  if (history) options.reverse();
  return <div className="capacity-filters">
    {!history && <CapacityStatusTabs status={status} onStatus={onStatus} counts={counts} ownOverview={ownOverview} />}
    <label className="date-filter region-filter">{_t("Klar for lasting i")}<select value={region} onChange={event => onRegion(event.target.value)}><option value="">{_t("Alle landsdeler")}</option>{loadingRegions.map(value => <option key={value} value={value}>{_t(value)}</option>)}<option value="unknown">{_t("Ikke oppgitt")}</option></select></label>
    <label className="date-filter">{_t("Ledigdato")}<select value={date} onChange={event => onDate(event.target.value)}><option value="">{_t("Alle datoer")}</option>{options.map(day => <option value={day} key={day}>{dateOptionLabel(day)}</option>)}</select></label>
    {date && <button type="button" className="clear-filter" onClick={() => onDate('')}>{_t("Vis alle datoer")}</button>}
  </div>;
}

export function VehicleTypeTabs({ selected, onSelect, counts }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  function tabKeys(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = vehicleTypeTabs.findIndex(tab => tab.id === selected);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? vehicleTypeTabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + vehicleTypeTabs.length) % vehicleTypeTabs.length;
    onSelect(vehicleTypeTabs[next].id);
    event.currentTarget.parentElement.querySelector(`#type-tab-${vehicleTypeTabs[next].id}`)?.focus();
  }
  return <div className="vehicle-type-tabs" role="tablist" aria-label={_t("Biltype og tilvalg")}>
    {vehicleTypeTabs.map(tab => <button key={tab.id} id={`type-tab-${tab.id}`} type="button" role="tab"
      aria-selected={selected === tab.id} aria-controls="vehicle-type-results" tabIndex={selected === tab.id ? 0 : -1}
      className={selected === tab.id ? 'selected' : ''} onClick={() => onSelect(tab.id)} onKeyDown={tabKeys}>
      {_t(tab.label)}<span>{counts[tab.id] || 0}</span>
    </button>)}
  </div>;
}

const Field = ({ label, children }) => { const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n(); return (<label>{_t(label)}{children}</label>); };
export function VehicleForm({ form, setForm, onSubmit, busy, submitLabel }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  const field = name => ({ value: form[name], onChange: e => setForm(old => ({ ...old, [name]: e.target.value })) });
  return <form onSubmit={onSubmit}>
    <Field label={_t("Transportør / firma")}><input required maxLength={200} {...field('carrier')} placeholder={_t("Firmanavn")} /></Field>
    <div className="two"><Field label={_t("Kontaktperson")}><input required maxLength={200} {...field('contact')} /></Field><Field label={_t("Telefon")}><input type="tel" required maxLength={50} {...field('phone')} /></Field></div>
    <div className="two"><Field label={_t("Registreringsnummer")}><input required maxLength={24} {...field('registration')} placeholder={_t("F.eks. YN 12345")} /></Field><Field label={_t("Trallenummer (valgfritt)")}><input maxLength={50} {...field('trailer_number')} placeholder={_t("Reg.nr eller internt trallenr")} /></Field></div>
    <Field label={_t("Hvor er bilen ledig?")}><input required maxLength={200} {...field('location')} /></Field>
    <Field label={_t("Landsdel klar for lasting")}><select required aria-describedby="loading-region-help" {...field('loading_region')}><option value="" disabled>{_t("Velg landsdel")}</option>{loadingRegions.map(region => <option key={region} value={region}>{_t(region)}</option>)}</select></Field>
    <p className="hint" id="loading-region-help">{_t("Nord-Norge: Nordland, Troms og Finnmark. Midt-Norge: Trøndelag. Sør-Norge: resten av Norge.")}</p>
    <div className="two"><Field label={_t("Dato (norsk tid)")}><input type="date" required {...field('date')} /></Field><Field label={_t("Klokkeslett (norsk tid)")}><input type="time" required {...field('time')} /></Field></div>
    <div className="two"><Field label={_t("Biltype")}><select {...field('vehicle_type')}><option value={"Termo"}>{_t("Termo")}</option><option value={"Express"}>{_t("Express")}</option><option value={"Standard"}>{_t("Standard")}</option>{form.vehicle_type === 'Sideåpning' && <option value={"Sideåpning"}>{_t("Sideåpning")}</option>}</select></Field><Field label={_t("Dører / tilvalg")}><select required {...field('door_type')}><option value="" disabled>{_t("Velg dører / tilvalg")}</option>{doorTypes.map(type => <option key={type} value={type}>{_t(type)}</option>)}</select></Field></div>
    <Field label={_t("Ønsket retning")}><input maxLength={200} {...field('direction')} /></Field>
    <Field label={_t("Kommentar om bilen")}><textarea maxLength={2000} {...field('comment')} placeholder={_t("Valgfritt")} /></Field>
    <button disabled={busy} className="primary full">{busy ? _t('Lagrer …') : _t(submitLabel)}</button>
  </form>;
}

export function VehicleTable({ rows, profile, userId, busy, onAction, onEvents }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  const admin = isAdmin(profile), staff = isStaff(profile);
  return <div className="table"><table className="vehicle-table"><thead><tr><th>{_t("Status")}</th><th>{_t("Transportør")}</th><th>{_t("Reg.nr / tralle / sted")}</th><th>{_t("Ledig fra")}</th><th>{_t("Biltype / tilvalg")}</th><th>{_t("Reservasjon / lass")}</th><th>{_t("Handling")}</th></tr></thead><tbody>
    {rows.map(row => <tr key={row.id} className={row.deleted_at ? 'deleted' : row.status === 'Ledig' ? 'available' : 'reserved'}>
      <td><span className={`pill ${row.deleted_at ? 'slettet' : row.status.toLowerCase()}`}>{row.deleted_at ? _t('Slettet') : _t(row.status)}</span>{row.is_history && !row.deleted_at && <small>{_t("Passert dato")}</small>}</td>
      <td><b>{row.carrier}</b><small>{row.contact}{row.phone ? ` · ${row.phone}` : ''}</small>{row.comment && <small className="multiline">{row.comment}</small>}</td>
      <td><b>{row.registration}</b><small>{_t("Tralle: ")}{row.trailer_number || _t('Ikke oppgitt')}</small><small>{row.location}</small><small className="loading-region">{_t("Klar for lasting: ")}{_t(row.loading_region) || _t('Ikke oppgitt')}</small><small>{_t("Retning: ")}{row.direction || '–'}</small></td>
      <td>{formatDate(row.available_at)[0]}<small>{_t("kl. ")}{formatDate(row.available_at)[1]}</small></td>
      <td>{_t(row.vehicle_type) || '–'}<small className="door-type">{_t(row.door_type) || _t('Tilvalg: Ikke oppgitt')}</small></td>
      <td className="reservation-cell">{row.status === 'Reservert' ? <><b>{row.reserved_by_name || row.reserved_by_email || _t('Ukjent bruker')}</b>{row.reserved_by_email && <small>{row.reserved_by_email}</small>}<small>{formatDate(row.reserved_at).join(' · ')}</small><p className="multiline">{row.reservation_comment || _t('Ingen lasskommentar registrert')}</p></> : <span className="muted">{_t("Ingen aktiv reservasjon")}</span>}</td>
      <td><div className="actions">
        {staff && !row.deleted_at && (!row.is_history || row.status === 'Reservert') && <button disabled={busy} className="book" onClick={() => onAction(row.status === 'Ledig' ? 'reserve' : 'release', row)}>{row.status === 'Ledig' ? _t('Reserver') : _t('Frigi')}</button>}
        {canEditVehicle(profile, userId, row) && <button disabled={busy} className="iconButton" onClick={() => onAction('edit', row)}>{_t("Rediger")}</button>}
        {canDeleteVehicle(profile, userId, row) && <button disabled={busy} className="iconButton delete-button" onClick={() => onAction('delete', row)}>{_t("Slett")}</button>}
        {admin && row.deleted_at && <button disabled={busy} className="iconButton" onClick={() => onAction('restore', row)}>{_t("Gjenopprett")}</button>}
        <button className="iconButton" disabled={busy} onClick={() => onEvents(row)}>{_t("Hendelser")}</button>
      </div></td>
    </tr>)}
  </tbody></table></div>;
}

export function Modal({ title, children, busy, onClose, message }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="capacity-dialog formcard" aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><h2 id="dialog-title">{_t(title)}</h2><button type="button" className="iconButton" disabled={busy} aria-label={_t("Lukk dialog")} onClick={onClose}>{_t("×")}</button></div>
    {_t(message) && <div role="alert" className="formerror">{_t(message)}</div>}
    {children}<button className="link" disabled={busy} onClick={onClose}>{_t("Lukk")}</button>
  </dialog>;
}

export function EventLog({ events, loading }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  if (loading) return <p role="status">{_t("Laster hendelser …")}</p>;
  if (!events.length) return <p>{_t("Ingen hendelser er registrert ennå. Nye handlinger logges automatisk.")}</p>;
  return <ol className="event-log">{events.map(event => {
    const snapshot = event.action === 'released' ? event.before_data : event.after_data;
    const changed = event.action === 'edited' ? Object.keys(vehicleLabels).filter(k => event.before_data?.[k] !== event.after_data?.[k]) : [];
    return <li key={event.id}><div><b>{_t(eventName(event.action))}</b><time>{formatDate(event.created_at).join(' · ')}</time></div>
      <p>{event.actor_name || event.actor_email || _t('Ukjent bruker')}{event.actor_email && event.actor_name ? ` · ${event.actor_email}` : ''}</p>
      {['reserved', 'released', 'reservation_imported'].includes(event.action) && <p className="event-comment multiline">{snapshot?.reservation_comment || _t('Ingen lasskommentar registrert')}</p>}
      {changed.length > 0 && <dl>{changed.map(k => <div key={k}><dt>{_t(vehicleLabels[k])}</dt><dd>{displayValue(k, event.before_data?.[k], formatDate, _t)} → {displayValue(k, event.after_data?.[k], formatDate, _t)}</dd></div>)}</dl>}
    </li>;
  })}</ol>;
}
function displayValue(key, value, formatDate, t) { if (key === 'available_at') return formatDate(value).join(' · '); if (!value) return t('Ikke oppgitt'); return ['vehicle_type', 'door_type', 'loading_region'].includes(key) ? t(String(value)) : String(value); }
