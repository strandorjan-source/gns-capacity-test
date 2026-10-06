'use client';
import { useI18n } from './i18n-provider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { blankVehicle, isStaff, isAdmin, roleName, canDeleteVehicle, canEditVehicle, filterVehicles, vehicleDates, matchesVehicleType, vehicleTypeCounts, vehiclePayload, vehicleChanges, vehicleForm, reservationComment, formatDate, authErrorFromUrl, userMessage, withTimeout } from '../lib/capacity.mjs';
import { VehicleForm, VehicleTable, CapacityFilters, CapacityStatusTabs, VehicleTypeTabs, Modal, EventLog } from './vehicle-components';
import LoadsBoard from './loads-board';
import { UsersPanel, RemovedAccess } from './user-components';
import { platformProfile, platformUsers } from '../lib/platform-access.mjs';

// Capture provider errors before the SDK consumes/cleans the callback URL.
const initialAuthError = typeof window !== 'undefined' ? authErrorFromUrl(window.location.href) : '';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } }) : null;

// Supabase caps each response. Read every page so old records never hide newer ones.
async function readAll(query) {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await withTimeout(query().range(start, start + 499));
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}

async function ensureProfile(user) {
  const platform = await withTimeout(supabase.rpc('platform_current_access'));
  if (platform.error) throw platform.error;
  const override = platformProfile(user, platform.data);
  if (override) return override;
  const read = () => withTimeout(supabase.from('capacity_profiles').select('*').eq('user_id', user.id).maybeSingle());
  const existing = await read();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const metadata = user.user_metadata || {};
  const created = await withTimeout(supabase.from('capacity_profiles').insert({
    user_id: user.id, email: user.email || '', full_name: metadata.full_name || metadata.name || user.email || '',
    company: metadata.company || '', role: 'carrier', approved: false,
  }).select().single());
  // INITIAL_SESSION and getSession may finish together. Never overwrite an
  // existing approval with an upsert when creating a first-time profile.
  if (created.error?.code === '23505') {
    const retry = await read();
    if (retry.error) throw retry.error;
    if (retry.data) return retry.data;
  }
  if (created.error) throw created.error;
  return created.data;
}

export default function Page() {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  const [session, setSession] = useState(null), [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]), [rows, setRows] = useState([]);
  const [view, setView] = useState('tower'), [q, setQ] = useState(''), [form, setForm] = useState(blankVehicle);
  const [phase, setPhase] = useState('loading'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [live, setLive] = useState(false);
  const [modal, setModal] = useState(null), [editing, setEditing] = useState(blankVehicle);
  const [loadComment, setLoadComment] = useState(''), [events, setEvents] = useState([]), [eventLoading, setEventLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('Ledig'), [dates, setDates] = useState({ tower: '', history: '' });
  const [region, setRegion] = useState('');
  const [vehicleType, setVehicleType] = useState('all');
  const eventRequest = useRef(0);
  const profileAccess = useRef(null);
  const generation = useRef(0), currentSession = useRef(null), busyRef = useRef(false);
  const staff = isStaff(profile), admin = isAdmin(profile);

  const load = useCallback(async (nextSession, silent = false) => {
    const ticket = ++generation.current;
    const changedUser = currentSession.current?.user?.id !== nextSession?.user?.id;
    currentSession.current = nextSession;
    setSession(nextSession);
    if (!silent) setPhase('loading');
    if (changedUser) { setProfile(null); setRows([]); setProfiles([]); setView('tower'); setForm(blankVehicle); setModal(null); setEvents([]); setStatus('Ledig'); setRegion(''); setVehicleType('all'); setDates({ tower: '', history: '' }); setQ(''); setPage(0); ++eventRequest.current; }
    try {
      if (!nextSession?.user) { setProfile(null); setRows([]); setProfiles([]); setPhase('ready'); return; }
      const nextProfile = await ensureProfile(nextSession.user);
      if (ticket !== generation.current) return;
      const nextAccess = `${nextProfile.user_id}:${nextProfile.role}:${nextProfile.approved}`;
      if (changedUser || profileAccess.current !== nextAccess) { setModal(null); setEvents([]); setStatus(isStaff(nextProfile) ? 'Ledig' : 'Alle'); setVehicleType('all'); ++eventRequest.current; }
      profileAccess.current = nextAccess;
      // Clear data immediately on revocation, before any further fetch.
      if (!nextProfile.approved || nextProfile.deleted_at) {
        setProfile(nextProfile); setRows([]); setProfiles([]); setView('tower'); setModal(null); setEvents([]); ++eventRequest.current; setPhase('ready'); return;
      }
      const vehicles = await readAll(() => supabase.from('capacity_vehicle_overview').select('*').order('available_at').order('id'));
      let nextProfiles = [];
      if (isAdmin(nextProfile)) {
        nextProfiles = await readAll(() => supabase.from('capacity_profiles').select('*').is('deleted_at', null).order('created_at', { ascending: false }).order('user_id'));
        const access = await withTimeout(supabase.rpc('capacity_platform_users'));
        if (access.error) throw access.error;
        nextProfiles = platformUsers(nextProfiles, access.data);
      }
      if (ticket !== generation.current) return;
      setProfile(nextProfile); setRows(vehicles); setProfiles(nextProfiles); setPhase('ready');
      if (changedUser) setForm({ ...blankVehicle, carrier: nextProfile.company || '', contact: nextProfile.full_name || '' });
    } catch (error) {
      if (ticket !== generation.current) return;
      setProfile(null); setRows([]); setProfiles([]); setModal(null); setEvents([]); ++eventRequest.current; setPhase('error'); setMessage(userMessage(error));
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setPhase('ready'); return; }
    let stopped = false;
    const timers = new Set();
    const showOAuthError = () => {
      const error = authErrorFromUrl(window.location.href);
      if (error) {
        setMessage(error);
        window.history.replaceState({}, '', window.location.pathname);
      }
    };
    if (initialAuthError) setMessage(initialAuthError);
    showOAuthError();
    // Handle same-document OAuth error navigation as well as a full callback.
    window.addEventListener('hashchange', showOAuthError);
    window.addEventListener('popstate', showOAuthError);
    withTimeout(supabase.auth.getSession()).then(({ data, error }) => {
      if (stopped) return;
      if (error) throw error;
      return load(data.session);
    }).catch(error => { if (!stopped) { setPhase('error'); setMessage(userMessage(error)); } });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Do not await Supabase calls inside its auth callback/lock.
      const timer = setTimeout(() => { timers.delete(timer); if (!stopped) load(nextSession, event === 'TOKEN_REFRESHED'); }, 0);
      timers.add(timer);
    });
    return () => {
      stopped = true; ++generation.current; timers.forEach(clearTimeout); data.subscription.unsubscribe();
      window.removeEventListener('hashchange', showOAuthError);
      window.removeEventListener('popstate', showOAuthError);
    };
  }, [load]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return;
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!busyRef.current) load(currentSession.current, true); }, 150);
    };
    const channel = supabase.channel(`capacity-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_vehicles' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_profiles', filter: `user_id=eq.${session.user.id}` }, refresh);
    if (admin) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'capacity_profiles' }, refresh);
    channel.subscribe(status => setLive(status === 'SUBSCRIBED'));
    // Realtime is an optimization, never the only way to notice approval/revocation.
    const poll = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 20000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(poll); clearTimeout(timer); window.removeEventListener('focus', refresh); supabase.removeChannel(channel); };
  }, [session?.user?.id, admin, load]);

  const activeRows = useMemo(() => rows.filter(row => !row.is_history), [rows]);
  const history = view === 'history', selectedDate = dates[history ? 'history' : 'tower'];
  const dateOptions = useMemo(() => vehicleDates(rows, history), [rows, history]);
  const matchingRows = useMemo(() => filterVehicles(rows, { history, date: selectedDate, query: q, region }), [rows, q, history, selectedDate, region]);
  const statusCounts = useMemo(() => ({ Alle: matchingRows.length, Ledig: matchingRows.filter(row => row.status === 'Ledig').length, Reservert: matchingRows.filter(row => row.status === 'Reservert').length }), [matchingRows]);
  const statusRows = useMemo(() => history || status === 'Alle' ? matchingRows : matchingRows.filter(row => row.status === status), [matchingRows, history, status]);
  const typeCounts = useMemo(() => vehicleTypeCounts(statusRows), [statusRows]);
  const filtered = useMemo(() => history ? statusRows : statusRows.filter(row => matchesVehicleType(row, vehicleType)), [statusRows, history, vehicleType]);
  function selectOverview(nextStatus) {
    if (nextStatus === 'Lass') { setView('loads'); return; }
    setView('tower'); setStatus(nextStatus); setVehicleType('all');
  }
  useEffect(() => setPage(0), [q, view, selectedDate, status, region, vehicleType]);
  const lastPage = Math.max(0, Math.ceil(filtered.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);

  async function action(work) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage('');
    try { await work(); } catch (error) { setMessage(userMessage(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const refresh = () => load(currentSession.current, true);
  async function login() {
    await action(async () => {
      const { error } = await withTimeout(supabase.auth.signInWithOAuth({ provider: 'azure', options: {
        scopes: 'email profile', redirectTo: `${window.location.origin}/`, queryParams: { prompt: 'select_account' },
      } }));
      if (error) throw error;
    });
  }
  async function logout() {
    await action(async () => {
      const { error } = await withTimeout(supabase.auth.signOut({ scope: 'local' }));
      if (error) throw error;
      await load(null);
    });
  }
  async function savePending(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    await action(async () => {
      const full_name = String(fields.get('full_name') || '').trim();
      const company = String(fields.get('company') || '').trim();
      if (!full_name || !company) throw new Error('Fyll ut navn og transportfirma.');
      const { data, error } = await withTimeout(supabase.from('capacity_profiles').update({ full_name, company }).eq('user_id', session.user.id).select().single());
      if (error) throw error;
      setProfile(data); setMessage('Opplysningene er lagret. GNS må godkjenne brukeren før du får tilgang.');
    });
  }
  async function submit(event) {
    event.preventDefault();
    await action(async () => {
      const payload = vehiclePayload(form, session.user.id);
      const { data, error } = await withTimeout(supabase.from('capacity_vehicles').insert(payload).select().single());
      if (error) throw error;
      await refresh();
      setForm({ ...blankVehicle, carrier: form.carrier, contact: form.contact, phone: form.phone });
      if (staff) setView('thanks');
      else { setView('tower'); setStatus('Alle'); setVehicleType('all'); setRegion(''); setQ(''); setDates(old => ({ ...old, tower: '' })); setPage(0); setMessage('Bilen er registrert. Her ser du dine innmeldte biler og reservasjoner.'); }
    });
  }
  function openModal(kind, row) {
    if (kind === 'edit' && !canEditVehicle(profile, session?.user?.id, row)) return;
    setMessage(''); setLoadComment(''); setEditing(vehicleForm(row)); setModal({ kind, row });
  }
  async function reserve(row, comment = null) {
    if (!staff) return;
    await action(async () => {
      const reserveNow = row.status === 'Ledig';
      const { data, error } = await withTimeout(supabase.from('capacity_vehicles').update({
        status: reserveNow ? 'Reservert' : 'Ledig', reservation_comment: reserveNow ? reservationComment(comment) : null,
      }).eq('id', row.id).eq('status', row.status).eq('updated_at', row.updated_at).select('id').maybeSingle());
      if (error) throw error;
      setModal(null);
      setMessage(data ? (reserveNow ? 'Bilen er reservert. Bruker, tidspunkt og lasskommentar er lagret.' : 'Bilen er frigitt. Reservasjonen er bevart i hendelsesloggen.') : 'Bilen ble endret av en annen bruker. Oversikten er oppdatert; prøv på nytt.');
      await refresh();
    });
  }
  async function remove(row) {
    if (!canDeleteVehicle(profile, session.user.id, row)) return;
    await action(async () => {
      const { data, error } = await withTimeout(supabase.from('capacity_vehicles').update({ deleted_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', row.status).eq('updated_at', row.updated_at).select('id').maybeSingle());
      if (error) throw error;
      setModal(null);
      setMessage(data ? 'Linjen er slettet fra oversikten og finnes under Historikk. Admin kan gjenopprette den.' : 'Bilen ble endret eller kan ikke slettes med din tilgang. Oversikten er oppdatert.');
      await refresh();
    });
  }
  async function editVehicle(event) {
    event.preventDefault();
    if (!canEditVehicle(profile, session?.user?.id, modal?.row)) return;
    await action(async () => {
      const { data, error } = await withTimeout(supabase.from('capacity_vehicles').update(vehicleChanges(editing))
        .eq('id', modal.row.id).eq('updated_at', modal.row.updated_at).select('id').maybeSingle());
      if (error) throw error;
      setModal(null);
      setMessage(data ? 'Endringene er lagret.' : 'Bilen ble endret av en annen bruker. Åpne Rediger på nytt fra den oppdaterte oversikten.');
      await refresh();
    });
  }
  async function restore(row) {
    if (!admin) return;
    await action(async () => {
      const { data, error } = await withTimeout(supabase.from('capacity_vehicles').update({ deleted_at: null })
        .eq('id', row.id).eq('updated_at', row.updated_at).select('id').maybeSingle());
      if (error) throw error;
      setModal(null);
      setMessage(data ? 'Linjen er gjenopprettet. Passerte ledigdatoer vises fortsatt under Historikk.' : 'Linjen ble endret. Oversikten er oppdatert.');
      await refresh();
    });
  }
  async function showEvents(row) {
    const ticket = ++eventRequest.current;
    openModal('events', row); setEvents([]); setEventLoading(true);
    try {
      const data = await readAll(() => supabase.from('capacity_vehicle_events').select('*').eq('vehicle_id', row.id).order('created_at', { ascending: false }).order('id', { ascending: false }));
      if (ticket === eventRequest.current) setEvents(data);
    } catch (error) { if (ticket === eventRequest.current) setMessage(userMessage(error)); }
    finally { if (ticket === eventRequest.current) setEventLoading(false); }
  }
  async function access(userId, changes) {
    if (!admin || userId === session.user.id) return;
    await action(async () => {
      const { data, error } = await withTimeout(supabase.from('capacity_profiles').update(changes).eq('user_id', userId).is('deleted_at', null).select('user_id').maybeSingle());
      if (error) throw error;
      if (!data) throw new Error('Tilgangen kunne ikke endres. Kontroller at du fortsatt er administrator.');
      await refresh();
    });
  }

  if (!supabase) return <Center title={_t("Mangler tilkobling")} text={_t("Supabase-miljøvariablene mangler i denne publiseringen. GNS må kontrollere Vercel-oppsettet og publisere på nytt.")} />;
  if (phase === 'loading') return <Center title="GNS Capacity" text={_t("Laster sikker innlogging og kapasitet …")} spin />;
  if (phase === 'error') return <Center title={_t("Kunne ikke laste GNS Capacity")} text={_t(message)} retry={() => load(currentSession.current)} logout={session ? logout : null} />;
  if (!session) return <Login login={login} message={message} busy={busy} />;
  if (profile?.platform_blocked) return <RemovedAccess logout={logout} busy={busy} />;
  if (profile?.deleted_at) return <RemovedAccess logout={logout} busy={busy} />;
  if (!profile?.approved) return <Pending profile={profile} save={savePending} logout={logout} busy={busy} message={message} refresh={refresh} />;

  const available = activeRows.filter(row => row.status === 'Ledig').length;
  const osloCount = activeRows.filter(row => row.status === 'Ledig' && /oslo|gardermoen/i.test(row.location)).length;
  return <main>
    <header><Brand /><nav>
      <button className={view === 'tower' ? 'active' : ''} onClick={() => { setView('tower'); if (!staff) { setStatus('Alle'); setVehicleType('all'); } }}>{staff ? 'Control Tower' : _t('Mine biler')}</button>
      <button className={view === 'register' ? 'active' : ''} onClick={() => setView('register')}>{_t("Meld inn bil")}</button>
      <button className={view === 'loads' ? 'active' : ''} onClick={() => setView('loads')}>{_t("Ledige lass")}</button>
      <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>{_t("Historikk")}</button>
      {admin && <button className={view === 'users' ? 'active' : ''} onClick={() => { setView('users'); refresh(); }}>{_t("Brukere")}</button>}
    </nav><div className="account"><span>{profile.full_name || profile.email}<small>{_t(roleName(profile.role))}</small></span><button disabled={busy} onClick={logout}>{_t("Logg ut")}</button></div></header>
    {_t(message) && <div className="notice" role="status">{_t(message)}<button aria-label={_t("Lukk melding")} onClick={() => setMessage('')}>{_t("×")}</button></div>}
    {(view === 'tower' || view === 'history') && <section className="wrap">
      <div className="hero"><div><span className="eyebrow">{view === 'history' ? _t('TIDLIGERE KAPASITET') : live ? _t('LIVE KAPASITET') : _t('KAPASITET · OPPDATERES HVERT 20. SEKUND')}</span><h1>{view === 'history' ? _t('Historikk') : staff ? _t('Alle biler') : _t('Mine biler')}</h1><p>{view === 'history' ? _t('Passerte ledigdatoer og slettede linjer. Reservasjoner og hendelser bevares.') : staff ? _t('Biler med ledigdato i dag eller senere. Passerte datoer flyttes automatisk til Historikk.') : _t('Dine innmeldte biler og reservasjoner. Trykk Rediger på en bil for å endre opplysningene. Reserverte biler vises til og med tredje dag etter lastedato, før de flyttes til Historikk.')}</p></div><button className="primary" onClick={() => setView('register')}>{_t("+ Meld inn bil")}</button></div>
      {view === 'tower' && <div className="stats"><Stat t={_t("LEDIGE BILER")} n={available} s={_t("Registrert tilgjengelig")} /><Stat t="OSLO / GARDERMOEN" n={osloCount} s={_t("Ledige biler i området")} /><Stat t={_t("TRANSPORTØRER")} n={new Set(activeRows.map(row => row.carrier)).size} s={_t("I din oversikt")} /><Stat t={_t("REGISTRERTE BILER")} n={activeRows.length} s={_t("Aktive poster")} /></div>}
      <div className="panel"><div className="toolbar"><div><h2>{view === 'history' ? _t('Tidligere innmeldte biler') : staff ? _t('Kapasitetstorg') : _t('Mine innmeldte biler')}</h2><p>{_t("Én linje per bil og ledigdato · Alle klokkeslett i norsk tid")}</p></div><input aria-label={_t("Søk biler")} placeholder={_t("Søk reg.nr, trallenr, transportør eller sted …")} value={q} onChange={e => setQ(e.target.value)} /><button disabled={busy} onClick={refresh}>{_t("Oppdater")}</button></div>
        <CapacityFilters history={history} dates={dateOptions} date={selectedDate} onDate={date => setDates(old => ({ ...old, [history ? 'history' : 'tower']: date }))} status={status} onStatus={selectOverview} counts={statusCounts} region={region} onRegion={setRegion} ownOverview={!staff} />
        <div id="vehicle-results" role={history ? undefined : 'tabpanel'} aria-labelledby={history ? undefined : status === 'Alle' ? 'tab-mine' : status === 'Ledig' ? 'tab-available' : 'tab-reserved'} tabIndex={0}>
        {!history && <VehicleTypeTabs selected={vehicleType} onSelect={setVehicleType} counts={typeCounts} />}
        <div id="vehicle-type-results" role={history ? undefined : 'tabpanel'} aria-labelledby={history ? undefined : `type-tab-${vehicleType}`} tabIndex={0}>
        <VehicleTable rows={filtered.slice(currentPage * 50, (currentPage + 1) * 50)} profile={profile} userId={session.user.id} busy={busy} onAction={openModal} onEvents={showEvents} />
        {!filtered.length && <div className="empty" role="status">{q || selectedDate || region || (!history && vehicleType !== 'all') ? _t('Ingen biler passer valgte filtre og søk i denne oversikten.') : history ? _t('Ingen biler i historikken ennå.') : status === 'Alle' ? _t('Du har ingen biler i oversikten. Meld inn en bil, eller se eldre registreringer i Historikk.') : status === 'Ledig' ? _t('Ingen ledige biler. Se også Reserverte biler eller Historikk.') : _t('Ingen reserverte biler. Tidligere ledigdatoer finner du under Historikk.')}</div>}
        {filtered.length > 50 && <div className="pagination"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{_t("Forrige")}</button><span>{_t("Side ")}{currentPage + 1}{_t(" av ")}{lastPage + 1} · {filtered.length}{_t(" linjer")}</span><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{_t("Neste")}</button></div>}
        </div>
        </div>
      </div>
    </section>}
    {view === 'loads' && <LoadsBoard key={`${session.user.id}:${profile.role}`} supabase={supabase} profile={profile}
      navigation={<CapacityStatusTabs status="Lass" onStatus={selectOverview} counts={statusCounts} ownOverview={!staff} panelId="load-results" />} />}
    {view === 'register' && <section className="formpage"><div className="formcard"><span className="eyebrow">GNS CAPACITY</span><h1>{_t("Meld inn ledig bil")}</h1><p>{_t("Registrer én konkret bil, velg dører / tilvalg og landsdelen der bilen er klar for lasting. Dato og klokkeslett angis i norsk tid.")}</p>
      <VehicleForm form={form} setForm={setForm} onSubmit={submit} busy={busy} submitLabel={_t("Meld inn ledig bil")} />
    </div></section>}
    {view === 'thanks' && <section className="thanks"><div><div className="check">✓</div><h1>{_t("Bilen er registrert")}</h1><p>{_t("Bilen er lagret. Dagens og fremtidige ledigdatoer vises i Control Tower. Passerte datoer vises i Historikk.")}</p><button className="primary" onClick={() => setView('register')}>{_t("Registrer en bil til")}</button><button className="link" onClick={() => { setView('tower'); refresh(); }}>{_t("Se Control Tower")}</button></div></section>}
    {view === 'users' && admin && <UsersPanel profiles={profiles} profile={profile} supabase={supabase} busy={busy} access={access} refresh={refresh} onRemoved={userId => setProfiles(old => old.filter(p => p.user_id !== userId))} />}
    {modal && <Modal title={`${{ edit: _t('Rediger bil'), reserve: _t('Reserver bil'), release: _t('Frigi bil'), delete: _t('Slett linje'), restore: _t('Gjenopprett linje'), events: _t('Hendelseslogg') }[modal.kind]} · ${modal.row.registration}`} busy={busy} onClose={() => { ++eventRequest.current; setModal(null); }} message={message}>
      {modal.kind === 'edit' && canEditVehicle(profile, session.user.id, modal.row) && <>{modal.row.status === 'Reservert' && <p className="hint">{_t("Bilen er reservert. Du kan oppdatere bilopplysningene; reservasjonen og lasskommentaren beholdes.")}</p>}<VehicleForm form={editing} setForm={setEditing} onSubmit={editVehicle} busy={busy} submitLabel={_t("Lagre endringer")} /></>}
      {modal.kind === 'reserve' && staff && <form onSubmit={e => { e.preventDefault(); reserve(modal.row, loadComment); }}><p>{modal.row.carrier} · {modal.row.location} · {formatDate(modal.row.available_at).join(' · ')}</p><Field label={_t("Hvilket lass bookes på bilen?")}><textarea autoFocus maxLength={2000} value={loadComment} onChange={e => setLoadComment(e.target.value)} placeholder={_t("F.eks. kunde, lastested, leveringssted og ordrenummer (valgfritt)")} /></Field><p className="hint">{_t("Reservasjonen lagres med din bruker og tidspunkt. Kommentaren er synlig for GNS og bilens transportør.")}</p><button disabled={busy} className="primary full">{busy ? _t('Reserverer …') : _t('Bekreft reservasjon')}</button></form>}
      {modal.kind === 'release' && staff && <><p>{_t("Frigi {registration}? Tidligere reservasjon, bruker og lasskommentar bevares i hendelsesloggen.", { registration: modal.row.registration })}</p><button className="primary full" disabled={busy} onClick={() => reserve(modal.row)}>{_t("Bekreft frigivelse")}</button></>}
      {modal.kind === 'delete' && <><p>{_t("Slette linjen for {registration}? Den fjernes fra kapasitetstorget og merkes som slettet i Historikk. Admin kan gjenopprette linjen.", { registration: modal.row.registration })}</p><button className="dangerButton full" disabled={busy} onClick={() => remove(modal.row)}>{_t("Bekreft sletting")}</button></>}
      {modal.kind === 'restore' && admin && <><p>{_t("Gjenopprett linjen for {registration}. Dersom ledigdatoen er passert, blir bilen liggende under Historikk.", { registration: modal.row.registration })}</p><button className="primary full" disabled={busy} onClick={() => restore(modal.row)}>{_t("Gjenopprett")}</button></>}
      {modal.kind === 'events' && <EventLog events={events} loading={eventLoading} />}
    </Modal>}
    <footer>GNS CARGO AS · CAPACITY CONTROL TOWER</footer>
  </main>;
}
const Brand = () => { const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n(); return (<div className="brand"><div className="mark">GNS</div><div><b>GNS CARGO AS</b><small>CAPACITY CONTROL TOWER</small></div></div>); };
const Stat = ({ t, n, s }) => { const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n(); return (<article><span>{_t(t)}</span><strong>{n}</strong><small>{_t(s)}</small></article>); };
const Field = ({ label, children }) => { const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n(); return (<label>{_t(label)}{children}</label>); };
const Center = ({ title, text, spin, retry, logout }) => { const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n(); return (<main className="authpage"><div className="authcard"><Brand />{spin && <div className="spinner" />}<h1>{_t(title)}</h1><p role="status">{_t(text)}</p>{retry && <button className="primary full" onClick={retry}>{_t("Prøv igjen")}</button>}{logout && <button className="link" onClick={logout}>{_t("Logg ut")}</button>}</div></main>); };
const Login = ({ login, message, busy }) => { const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n(); return (<main className="authpage"><div className="authcard"><Brand /><span className="eyebrow">{_t("SIKKER INNLOGGING")}</span><h1>{_t("Velkommen til GNS Capacity")}</h1><p>{_t("Logg inn med Microsoft-kontoen din. Nye transportører må godkjennes av GNS før de får tilgang.")}</p>{_t(message) && <div role="alert" className="formerror">{_t(message)}</div>}<button disabled={busy} className="microsoft" onClick={login}><i><span /><span /><span /><span /></i>{busy ? _t('Åpner Microsoft …') : _t('Logg inn med Microsoft')}</button><small className="secure">{_t("Tilgangen styres av GNS Cargo AS")}</small></div></main>); };
const Pending = ({ profile, save, logout, busy, message, refresh }) => { const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n(); return (<main className="authpage"><div className="authcard pending"><Brand /><span className="eyebrow">{_t("VENTER PÅ GODKJENNING")}</span><h1>{_t("Fullfør brukerprofilen")}</h1><p>{_t("GNS må godkjenne kontoen før kapasitetstorget åpnes. Siden oppdateres automatisk når tilgangen endres.")}</p>{_t(message) && <div role="status" className="formnotice">{_t(message)}</div>}<form onSubmit={save}><Field label={_t("Navn")}><input name="full_name" required maxLength={200} defaultValue={profile?.full_name || ''} /></Field><Field label={_t("Transportfirma")}><input name="company" required maxLength={200} defaultValue={profile?.company || ''} placeholder={_t("Firmanavn")} /></Field><button disabled={busy} className="primary full">{busy ? _t('Lagrer …') : _t('Lagre opplysninger')}</button></form><button disabled={busy} className="link" onClick={refresh}>{_t("Kontroller godkjenning")}</button><button disabled={busy} className="link" onClick={logout}>{_t("Logg ut")}</button></div></main>); };
