'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { blankVehicle, isStaff, isAdmin, roleName, canDeleteVehicle, vehiclePayload, formatDate, authErrorFromUrl, userMessage, withTimeout } from '../lib/capacity.mjs';

// Capture provider errors before the SDK consumes/cleans the callback URL.
const initialAuthError = typeof window !== 'undefined' ? authErrorFromUrl(window.location.href) : '';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } }) : null;

async function ensureProfile(user) {
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
  const [session, setSession] = useState(null), [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]), [rows, setRows] = useState([]);
  const [view, setView] = useState('tower'), [q, setQ] = useState(''), [form, setForm] = useState(blankVehicle);
  const [phase, setPhase] = useState('loading'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [live, setLive] = useState(false);
  const generation = useRef(0), currentSession = useRef(null), busyRef = useRef(false);
  const staff = isStaff(profile), admin = isAdmin(profile);

  const load = useCallback(async (nextSession, silent = false) => {
    const ticket = ++generation.current;
    const changedUser = currentSession.current?.user?.id !== nextSession?.user?.id;
    currentSession.current = nextSession;
    setSession(nextSession);
    if (!silent) setPhase('loading');
    if (changedUser) { setProfile(null); setRows([]); setProfiles([]); setView('tower'); setForm(blankVehicle); }
    try {
      if (!nextSession?.user) { setProfile(null); setRows([]); setProfiles([]); setPhase('ready'); return; }
      const nextProfile = await ensureProfile(nextSession.user);
      if (ticket !== generation.current) return;
      // Clear data immediately on revocation, before any further fetch.
      if (!nextProfile.approved) {
        setProfile(nextProfile); setRows([]); setProfiles([]); setView('tower'); setPhase('ready'); return;
      }
      const vehicles = await withTimeout(supabase.from('capacity_vehicles').select('*').order('available_at'));
      if (vehicles.error) throw vehicles.error;
      let nextProfiles = [];
      if (isAdmin(nextProfile)) {
        const users = await withTimeout(supabase.from('capacity_profiles').select('*').order('created_at', { ascending: false }));
        if (users.error) throw users.error;
        nextProfiles = users.data || [];
      }
      if (ticket !== generation.current) return;
      setProfile(nextProfile); setRows(vehicles.data || []); setProfiles(nextProfiles); setPhase('ready');
      if (changedUser) setForm({ ...blankVehicle, carrier: nextProfile.company || '', contact: nextProfile.full_name || '' });
    } catch (error) {
      if (ticket !== generation.current) return;
      setProfile(null); setRows([]); setProfiles([]); setPhase('error'); setMessage(userMessage(error));
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setPhase('ready'); return; }
    let stopped = false;
    const timers = new Set();
    const oauthError = initialAuthError || authErrorFromUrl(window.location.href);
    if (oauthError) {
      setMessage(oauthError);
      window.history.replaceState({}, '', window.location.pathname);
    }
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
    return () => { stopped = true; ++generation.current; timers.forEach(clearTimeout); data.subscription.unsubscribe(); };
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter(row => [row.carrier, row.contact, row.registration, row.location, row.vehicle_type, row.direction].some(v => String(v || '').toLowerCase().includes(needle))) : rows;
  }, [rows, q]);

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
      setRows(old => [...old.filter(row => row.id !== data.id), data]);
      setForm({ ...blankVehicle, carrier: form.carrier, contact: form.contact, phone: form.phone });
      setView('thanks');
    });
  }
  async function reserve(row) {
    if (!staff) return;
    await action(async () => {
      const reserveNow = row.status === 'Ledig';
      const { data, error } = await withTimeout(supabase.from('capacity_vehicles').update({
        status: reserveNow ? 'Reservert' : 'Ledig', reserved_by: reserveNow ? session.user.id : null,
        reserved_at: reserveNow ? new Date().toISOString() : null,
      }).eq('id', row.id).eq('status', row.status).eq('updated_at', row.updated_at).select('id').maybeSingle());
      if (error) throw error;
      if (!data) setMessage('Bilen ble endret av en annen bruker. Oversikten er oppdatert; prøv på nytt.');
      await refresh();
    });
  }
  async function remove(row) {
    if (!canDeleteVehicle(profile, session.user.id, row) || !window.confirm(`Slette ${row.registration} fra kapasitetstorget?`)) return;
    await action(async () => {
      const { data, error } = await withTimeout(supabase.from('capacity_vehicles').delete()
        .eq('id', row.id).eq('status', row.status).eq('updated_at', row.updated_at).select('id').maybeSingle());
      if (error) throw error;
      if (!data) setMessage('Bilen ble endret eller kan ikke slettes med din tilgang. Oversikten er oppdatert.');
      await refresh();
    });
  }
  async function access(userId, changes) {
    if (!admin || userId === session.user.id) return;
    await action(async () => {
      const { data, error } = await withTimeout(supabase.from('capacity_profiles').update(changes).eq('user_id', userId).select('user_id').maybeSingle());
      if (error) throw error;
      if (!data) throw new Error('Tilgangen kunne ikke endres. Kontroller at du fortsatt er administrator.');
      await refresh();
    });
  }
  const field = name => ({ value: form[name], onChange: e => setForm(old => ({ ...old, [name]: e.target.value })) });

  if (!supabase) return <Center title="Mangler tilkobling" text="Supabase-miljøvariablene mangler i denne publiseringen. GNS må kontrollere Vercel-oppsettet og publisere på nytt." />;
  if (phase === 'loading') return <Center title="GNS Capacity" text="Laster sikker innlogging og kapasitet …" spin />;
  if (phase === 'error') return <Center title="Kunne ikke laste GNS Capacity" text={message} retry={() => load(currentSession.current)} logout={session ? logout : null} />;
  if (!session) return <Login login={login} message={message} busy={busy} />;
  if (!profile?.approved) return <Pending profile={profile} save={savePending} logout={logout} busy={busy} message={message} refresh={refresh} />;

  const available = rows.filter(row => row.status === 'Ledig').length;
  const osloCount = rows.filter(row => row.status === 'Ledig' && /oslo|gardermoen/i.test(row.location)).length;
  return <main>
    <header><Brand /><nav>
      <button className={view === 'tower' ? 'active' : ''} onClick={() => setView('tower')}>Control Tower</button>
      <button className={view === 'register' ? 'active' : ''} onClick={() => setView('register')}>Meld inn bil</button>
      {admin && <button className={view === 'users' ? 'active' : ''} onClick={() => { setView('users'); refresh(); }}>Brukere</button>}
    </nav><div className="account"><span>{profile.full_name || profile.email}<small>{roleName(profile.role)}</small></span><button disabled={busy} onClick={logout}>Logg ut</button></div></header>
    {message && <div className="notice" role="status">{message}<button aria-label="Lukk melding" onClick={() => setMessage('')}>×</button></div>}
    {view === 'tower' && <section className="wrap">
      <div className="hero"><div><span className="eyebrow">{live ? 'LIVE KAPASITET' : 'KAPASITET · OPPDATERES HVERT 20. SEKUND'}</span><h1>{staff ? 'Alle biler' : 'Mine biler'}</h1><p>{staff ? 'Samlet oversikt over transportørenes tilgjengelige kapasitet.' : 'Oversikt over bilene din bruker har meldt inn.'}</p></div><button className="primary" onClick={() => setView('register')}>+ Meld inn bil</button></div>
      <div className="stats"><Stat t="LEDIGE BILER" n={available} s="Registrert tilgjengelig" /><Stat t="OSLO / GARDERMOEN" n={osloCount} s="Ledige biler i området" /><Stat t="TRANSPORTØRER" n={new Set(rows.map(row => row.carrier)).size} s="I din oversikt" /><Stat t="REGISTRERTE BILER" n={rows.length} s="Aktive poster" /></div>
      <div className="panel"><div className="toolbar"><div><h2>Kapasitetstorg</h2><p>Én rad per registreringsnummer · Alle klokkeslett i norsk tid</p></div><input aria-label="Søk biler" placeholder="Søk reg.nr, sted, transportør, retning …" value={q} onChange={e => setQ(e.target.value)} /><button disabled={busy} onClick={refresh}>Oppdater</button></div>
        <div className="table"><div className="tr head"><span>Status</span><span>Transportør</span><span>Reg.nr</span><span>Sted</span><span>Tilgjengelig</span><span>Biltype</span><span>Retning</span><span>Handling</span></div>
          {filtered.map(row => { const [date, time] = formatDate(row.available_at); return <div className={`tr ${row.status === 'Ledig' ? 'available' : 'reserved'}`} key={row.id}>
            <span><i className={`pill ${row.status.toLowerCase()}`}>{row.status}</i></span><span><b>{row.carrier}</b><small>{row.contact}{row.phone ? ` · ${row.phone}` : ''}</small>{row.comment && <small>{row.comment}</small>}</span><span><b>{row.registration}</b></span><span>{row.location}</span><span>{date}<small>{time}</small></span><span>{row.vehicle_type || '–'}</span><span>{row.direction || '–'}</span>
            <span className="actions">{staff && <button disabled={busy} className="book" onClick={() => reserve(row)}>{row.status === 'Ledig' ? 'Reserver' : 'Frigi'}</button>}{canDeleteVehicle(profile, session.user.id, row) && <button disabled={busy} className="iconButton" onClick={() => remove(row)}>Slett</button>}</span>
          </div>; })}
          {!filtered.length && <div className="empty">{q ? 'Ingen biler passer søket.' : 'Ingen biler i denne oversikten ennå.'}</div>}
        </div>
      </div>
    </section>}
    {view === 'register' && <section className="formpage"><div className="formcard"><span className="eyebrow">GNS CAPACITY</span><h1>Meld inn ledig bil</h1><p>Registrer én konkret bil med registreringsnummer. Dato og klokkeslett angis i norsk tid.</p>
      <form onSubmit={submit}><Field label="Transportør / firma"><input required maxLength={200} {...field('carrier')} placeholder="Firmanavn" /></Field>
        <div className="two"><Field label="Kontaktperson"><input required maxLength={200} {...field('contact')} /></Field><Field label="Telefon"><input type="tel" required maxLength={50} {...field('phone')} /></Field></div>
        <div className="two"><Field label="Registreringsnummer"><input required maxLength={24} {...field('registration')} placeholder="F.eks. YN 12345" /></Field><Field label="Hvor er bilen ledig?"><input required maxLength={200} {...field('location')} /></Field></div>
        <div className="two"><Field label="Dato (norsk tid)"><input type="date" required {...field('date')} /></Field><Field label="Klokkeslett (norsk tid)"><input type="time" required {...field('time')} /></Field></div>
        <div className="two"><Field label="Biltype"><select {...field('vehicle_type')}><option>Termo</option><option>Express</option><option>Standard</option><option>Sideåpning</option></select></Field><Field label="Ønsket retning"><input maxLength={200} {...field('direction')} /></Field></div>
        <Field label="Kommentar"><textarea maxLength={2000} {...field('comment')} placeholder="Valgfritt" /></Field><button disabled={busy} className="primary full">{busy ? 'Registrerer …' : 'Meld inn ledig bil'}</button>
      </form></div></section>}
    {view === 'thanks' && <section className="thanks"><div><div className="check">✓</div><h1>Bilen er registrert</h1><p>GNS Cargo kan nå se bilen og registreringsnummeret i Control Tower.</p><button className="primary" onClick={() => setView('register')}>Registrer en bil til</button><button className="link" onClick={() => { setView('tower'); refresh(); }}>Se Control Tower</button></div></section>}
    {view === 'users' && admin && <section className="wrap users"><div className="hero"><div><span className="eyebrow">TILGANGSSTYRING</span><h1>Brukere</h1><p>Godkjenn nye brukere og velg riktig rolle. Egen administratortilgang kan ikke fjernes her.</p></div></div><div className="panel userlist">
      {profiles.map(p => <div className="userrow" key={p.user_id}><div><b>{p.full_name || 'Navn ikke registrert'}</b><small>{p.email}{p.company ? ` · ${p.company}` : ''}</small></div>
        <select aria-label={`Rolle for ${p.full_name || p.email}`} disabled={busy || p.user_id === session.user.id} value={p.role} onChange={e => access(p.user_id, { role: e.target.value })}><option value="carrier">Transportør</option><option value="dispatcher">Dispatcher</option><option value="admin">Admin</option></select>
        <button disabled={busy || p.user_id === session.user.id} className={p.approved ? 'dangerButton' : 'approveButton'} onClick={() => access(p.user_id, { approved: !p.approved })}>{p.approved ? 'Trekk tilgang' : 'Godkjenn'}</button></div>)}
    </div></section>}
    <footer>GNS CARGO AS · CAPACITY CONTROL TOWER</footer>
  </main>;
}
const Brand = () => <div className="brand"><div className="mark">GNS</div><div><b>GNS CARGO AS</b><small>CAPACITY CONTROL TOWER</small></div></div>;
const Stat = ({ t, n, s }) => <article><span>{t}</span><strong>{n}</strong><small>{s}</small></article>;
const Field = ({ label, children }) => <label>{label}{children}</label>;
const Center = ({ title, text, spin, retry, logout }) => <main className="authpage"><div className="authcard"><Brand />{spin && <div className="spinner" />}<h1>{title}</h1><p role="status">{text}</p>{retry && <button className="primary full" onClick={retry}>Prøv igjen</button>}{logout && <button className="link" onClick={logout}>Logg ut</button>}</div></main>;
const Login = ({ login, message, busy }) => <main className="authpage"><div className="authcard"><Brand /><span className="eyebrow">SIKKER INNLOGGING</span><h1>Velkommen til GNS Capacity</h1><p>Logg inn med Microsoft-kontoen din. Nye transportører må godkjennes av GNS før de får tilgang.</p>{message && <div role="alert" className="formerror">{message}</div>}<button disabled={busy} className="microsoft" onClick={login}><i><span /><span /><span /><span /></i>{busy ? 'Åpner Microsoft …' : 'Logg inn med Microsoft'}</button><small className="secure">Tilgangen styres av GNS Cargo AS</small></div></main>;
const Pending = ({ profile, save, logout, busy, message, refresh }) => <main className="authpage"><div className="authcard pending"><Brand /><span className="eyebrow">VENTER PÅ GODKJENNING</span><h1>Fullfør brukerprofilen</h1><p>GNS må godkjenne kontoen før kapasitetstorget åpnes. Siden oppdateres automatisk når tilgangen endres.</p>{message && <div role="status" className="formnotice">{message}</div>}<form onSubmit={save}><Field label="Navn"><input name="full_name" required maxLength={200} defaultValue={profile?.full_name || ''} /></Field><Field label="Transportfirma"><input name="company" required maxLength={200} defaultValue={profile?.company || ''} placeholder="Firmanavn" /></Field><button disabled={busy} className="primary full">{busy ? 'Lagrer …' : 'Lagre opplysninger'}</button></form><button disabled={busy} className="link" onClick={refresh}>Kontroller godkjenning</button><button disabled={busy} className="link" onClick={logout}>Logg ut</button></div></main>;
