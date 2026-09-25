'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAdmin, osloDate, userMessage, withTimeout } from '../lib/capacity.mjs';
import { blankLoad, isCurrentLoad, loadChanges, loadForm } from '../lib/loads.mjs';
import { LoadForm, LoadList } from './load-components';
import { Modal } from './vehicle-components';

export default function LoadsBoard({ supabase, profile, navigation }) {
  const admin = isAdmin(profile);
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true);
  const [history, setHistory] = useState(false), [message, setMessage] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [interestBusyId, setInterestBusyId] = useState(null);
  const [modal, setModal] = useState(null), [form, setForm] = useState(blankLoad);
  const request = useRef(0), working = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    const ticket = ++request.current;
    if (!silent) setLoading(true);
    try {
      const entries = [], today = osloDate();
      for (let start = 0; ; start += 500) {
        let query = supabase.from('capacity_loads').select('*, interests:capacity_load_interests(load_id,user_id,interested,updated_at,person:capacity_profiles(full_name,company,email))').order('loading_date', { ascending: !history }).order('id');
        query = admin && history ? query.or(`deleted_at.not.is.null,loading_date.lt.${today}`) : query.is('deleted_at', null).gte('loading_date', today);
        const { data, error: failure } = await withTimeout(query.range(start, start + 499));
        if (failure) throw failure;
        entries.push(...data);
        if (data.length < 500) break;
      }
      if (ticket === request.current) { setRows(entries); setError(''); }
    } catch (failure) {
      if (ticket === request.current) { setRows([]); setError(userMessage(failure)); }
    } finally { if (ticket === request.current) setLoading(false); }
  }, [supabase, admin, history]);

  useEffect(() => {
    refresh();
    const update = () => { if (!working.current && document.visibilityState === 'visible') refresh(true); };
    const timer = setInterval(update, 20000);
    window.addEventListener('focus', update);
    return () => { ++request.current; clearInterval(timer); window.removeEventListener('focus', update); };
  }, [refresh]);

  function openForm(row = null) {
    if (!admin) return;
    setMessage(''); setForm(row ? loadForm(row) : { ...blankLoad, loading_date: osloDate(), contact_name: profile.full_name || '' });
    setModal({ kind: 'edit', row });
  }
  async function change(work) {
    if (!admin || working.current) return;
    working.current = true; setBusy(true); setMessage('');
    try { await work(); } catch (failure) { setMessage(userMessage(failure)); }
    finally { working.current = false; setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    await change(async () => {
      const changes = loadChanges(form);
      if (changes.loading_date < osloDate()) throw new Error('Velg en lastedato i dag eller senere for å publisere lasset.');
      const query = modal.row
        ? supabase.from('capacity_loads').update({ ...changes, deleted_at: null }).eq('id', modal.row.id).eq('updated_at', modal.row.updated_at)
        : supabase.from('capacity_loads').insert(changes);
      const { data, error: failure } = await withTimeout(query.select('id').maybeSingle());
      if (failure) throw failure;
      if (!data) throw new Error('Lasset er endret av en annen admin. Lukk skjemaet, oppdater oversikten og åpne lasset på nytt.');
      setModal(null); setHistory(false); setMessage('Lasset er publisert og synlig for alle godkjente transportører.');
      await refresh(true);
    });
  }
  async function setRemoved(row, removed) {
    await change(async () => {
      const { data, error: failure } = await withTimeout(supabase.from('capacity_loads')
        .update({ deleted_at: removed ? new Date().toISOString() : null })
        .eq('id', row.id).eq('updated_at', row.updated_at).select('id').maybeSingle());
      if (failure) throw failure;
      if (!data) throw new Error('Lasset er endret av en annen admin. Oppdater oversikten og prøv igjen.');
      setModal(null); setMessage(removed ? 'Lasset er fjernet fra transportørenes oversikt.' : 'Lasset er tilgjengelig for transportørene igjen.');
      await refresh(true);
    });
  }
  function restore(row) {
    if (row.loading_date < osloDate()) openForm(row);
    else setRemoved(row, false);
  }

  async function interest(row) {
    if (!profile?.approved || profile.role !== 'carrier' || working.current) return;
    const existing = row.interests?.find(entry => entry.user_id === profile.user_id);
    const interested = !existing?.interested;
    working.current = true; setBusy(true); setInterestBusyId(row.id); setMessage('');
    try {
      const query = existing
        ? supabase.from('capacity_load_interests').update({ interested }).eq('load_id', row.id).eq('user_id', profile.user_id).eq('updated_at', existing.updated_at)
        : supabase.from('capacity_load_interests').insert({ load_id: row.id, user_id: profile.user_id, interested: true });
      const { data, error: failure } = await withTimeout(query.select('load_id').maybeSingle());
      if (failure && failure.code !== '23505') throw failure;
      if (!data && !failure) throw new Error('Interessen er endret fra en annen side. Trykk Oppdater og prøv igjen.');
      setMessage(failure?.code === '23505' ? 'Du har allerede en registrering på dette lasset. Oversikten er oppdatert.' : interested ? 'Interessen din er registrert hos GNS. Transporten avtales med kontaktpersonen.' : 'Interessen din er trukket tilbake.');
      await refresh(true);
    } catch (failure) { setMessage(userMessage(failure)); }
    finally { working.current = false; setBusy(false); setInterestBusyId(null); }
  }

  return <section className="wrap loads-board">
    <div className="hero"><div><span className="eyebrow">GNS CAPACITY</span><h1>Ledige lass</h1><p>Lass fra GNS, tilgjengelige for alle godkjente transportører. Kontakt oppgitt kontaktperson for å avtale transport.</p></div>
      {admin && <button className="primary" disabled={busy} onClick={() => openForm()}>+ Legg inn lass</button>}
    </div>
    {navigation && <div className="load-navigation">{navigation}</div>}
    <div id="load-results" role="tabpanel" aria-labelledby="tab-loads" tabIndex={0}>
    <div className="load-toolbar"><h2>{history && admin ? 'Tidligere og fjernede lass' : 'Tilgjengelige lass'}</h2><div>
      {admin && <label><input type="checkbox" checked={history} disabled={busy} onChange={event => { setRows([]); setHistory(event.target.checked); setMessage(''); }} /> Vis tidligere og fjernede lass</label>}
      <button disabled={busy || loading} onClick={() => refresh()}>Oppdater</button>
    </div></div>
    {message && !modal && <div role="status" className="load-notice">{message}</div>}
    {error && <div role="alert" className="formerror">Kunne ikke hente lass: {error}</div>}
    {loading ? <p role="status" className="empty">Laster lass …</p> : <>
      <LoadList rows={rows} profile={profile} busy={busy} onEdit={openForm} onRemove={row => { setMessage(''); setModal({ kind: 'remove', row }); }} onRestore={restore} onInterest={interest} interestBusyId={interestBusyId} />
      {!rows.length && !error && <div className="panel empty">{history && admin ? 'Ingen tidligere eller fjernede lass.' : admin ? 'Ingen ledige lass ennå. Trykk «Legg inn lass» for å publisere et lass.' : 'Ingen ledige lass akkurat nå. Nye lass vises her når GNS publiserer dem.'}</div>}
    </>}
    </div>
    {modal && admin && <Modal title={modal.kind === 'remove' ? 'Fjern lass' : modal.row ? 'Rediger lass' : 'Legg inn ledig lass'} busy={busy} message={message} onClose={() => setModal(null)}>
      {modal.kind === 'edit' ? <LoadForm form={form} setForm={setForm} busy={busy} onSubmit={save} submitLabel={modal.row && isCurrentLoad(modal.row) ? 'Lagre endringer' : 'Publiser lass'} />
        : <><p>Fjerne lasset fra {modal.row.pickup} til {modal.row.delivery}? Det blir borte fra transportørenes oversikt og kan gjenopprettes av admin.</p><button className="dangerButton full" disabled={busy} onClick={() => setRemoved(modal.row, true)}>{busy ? 'Fjerner …' : 'Fjern fra ledige lass'}</button></>}
    </Modal>}
  </section>;
}
