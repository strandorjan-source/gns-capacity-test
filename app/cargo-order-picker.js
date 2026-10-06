'use client';
import { useEffect, useMemo, useState } from 'react';
import { withTimeout } from '../lib/capacity.mjs';

export default function CargoOrderPicker({ supabase, selected, onSelect, reservedOrderIds, vehicle, busy }) {
  const [orders, setOrders] = useState([]), [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); onSelect(null);
    async function read() {
      try {
        const access = await withTimeout(supabase.rpc('platform_current_access'));
        if (access.error) throw access.error;
        if (!['admin', 'dispatcher', 'superuser'].includes(access.data?.role)) throw new Error('Du trenger tilgang til GNS Cargo for å hente ordre. Du kan fortsatt reservere med en egen kommentar.');
        const result = [];
        for (let from = 0; ; from += 500) {
          const page = await withTimeout(supabase.from('orders').select('id,order_number,customer,pickup_name,delivery_name,pickup_date,pickup_at,carrier_name,vehicle_registration,status,updated_at')
            .eq('customer_invoice_sent', false).order('order_number', { ascending: false }).range(from, from + 499));
          if (page.error) throw page.error;
          result.push(...(page.data || []));
          if (!active) return;
          if ((page.data || []).length < 500) break;
        }
        if (active) setOrders(result.filter(order => !['completed', 'cancelled', 'canceled', 'delivered'].includes(order.status)));
      } catch (cause) { if (active) { setOrders([]); setError(cause.message || 'Kunne ikke hente lass fra GNS Cargo.'); } }
      finally { if (active) setLoading(false); }
    }
    read(); return () => { active = false; };
  }, [supabase, onSelect, reload]);
  const available = useMemo(() => orders.filter(order => !reservedOrderIds.includes(order.id)), [orders, reservedOrderIds]);
  const matches = available.filter(order => [order.order_number, 'GNS-' + order.order_number, order.customer, order.pickup_name, order.delivery_name].some(value => String(value || '').toLocaleLowerCase('nb-NO').includes(search.trim().toLocaleLowerCase('nb-NO'))));
  const visible = selected && !matches.some(order => order.id === selected.id) ? [selected, ...matches] : matches;
  return <section className="cargo-order-picker" aria-label="Hent lass fra GNS Cargo">
    <h3>Hent lass fra GNS Cargo</h3>
    {loading ? <p role="status">Henter aktive ordre …</p> : error ? <p role="alert" className="formerror">{error}</p> : <>
      <label>Søk etter lass<input type="search" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} placeholder="GNS-referanse, kunde eller sted" /></label>
      <label>Velg ordre (valgfritt)<select value={selected?.id || ''} disabled={busy} onChange={event => onSelect(available.find(order => order.id === event.target.value) || null)}>
        <option value="">Ingen ordrekobling – bruk egen kommentar</option>
        {visible.map(order => <option key={order.id} value={order.id}>GNS-{order.order_number} · {order.pickup_date || order.pickup_at?.slice(0, 10) || 'Udatert'} · {order.pickup_name || 'Ukjent lastested'} → {order.delivery_name || 'Lossested ikke avklart'} · {order.customer}</option>)}
      </select></label>
      {!matches.length && <p className="hint">{search ? 'Ingen ordre passer søket.' : 'Ingen aktive, ledige Cargo-ordre tilgjengelig.'}</p>}
      {selected && <div className="cargo-order-summary"><b>GNS-{selected.order_number}</b><p>{selected.pickup_name} → {selected.delivery_name || 'Lossested ikke avklart'}</p><p>Ordren oppdateres med {vehicle.carrier} og reg.nr {vehicle.registration} ved bekreftelse.</p>{(selected.carrier_name || selected.vehicle_registration) && <p>Nå registrert på ordren: {selected.carrier_name || 'Ukjent transportør'} · {selected.vehicle_registration || 'Reg.nr mangler'}. Dette erstattes.</p>}<p className="hint">Kun GNS-referansen og din kommentar vises i reservasjonen til transportøren. Losseinfo sendes fra ordren.</p></div>}
    </>}
    <button className="iconButton" type="button" disabled={busy || loading} onClick={() => setReload(value => value + 1)}>Hent lass på nytt</button>
  </section>;
}
