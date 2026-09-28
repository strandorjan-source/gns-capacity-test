'use client';
// CI only: copied into app/users-check for browser tests, never deployed.
import { useRef, useState } from 'react';
import { UsersPanel, RemovedAccess } from '../user-components';

const initial = [
  { user_id: 'admin', full_name: 'Current Admin', email: 'admin@example.invalid', role: 'admin', approved: true },
  { user_id: 'pending', full_name: 'Pending Request', email: 'pending@example.invalid', company: 'Test Transport', role: 'carrier', approved: false },
  { user_id: 'revoked', full_name: 'Revoked User', email: 'revoked@example.invalid', role: 'carrier', approved: false },
  { user_id: 'active', full_name: 'Active User', email: 'active@example.invalid', role: 'carrier', approved: true },
  { user_id: 'stale', full_name: 'Race Request', email: 'race@example.invalid', role: 'carrier', approved: false },
  { user_id: 'removed', full_name: 'Previously Removed', email: 'removed@example.invalid', role: 'carrier', approved: false, deleted_at: '2026-09-28T00:00:00Z' },
];

export default function UsersCheck() {
  const backend = useRef(initial.map(item => ({ ...item })));
  const [profiles, setProfiles] = useState(backend.current);
  const [calls, setCalls] = useState(0);
  const [closed, setClosed] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const refresh = async () => setProfiles([...backend.current]);
  const client = { from(table) {
    if (table !== 'capacity_profiles') throw Error('Wrong table');
    let payload; const filters = [];
    const query = {
      update(value) { payload = value; return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return query; },
      select() { return query; },
      async maybeSingle() {
        setCalls(value => value + 1);
        if (failNext) { setFailNext(false); return { data: null, error: new Error('Test database unavailable') }; }
        const found = backend.current.find(row => filters.every(filter => filter(row)));
        if (!found) return { data: null, error: null };
        if (Object.keys(payload).join() !== 'deleted_at' || found.approved) throw Error('Unsafe removal payload');
        backend.current = backend.current.map(row => row.user_id === found.user_id ? { ...row, deleted_at: new Date().toISOString(), deleted_by: 'admin' } : row);
        return { data: { user_id: found.user_id }, error: null };
      },
    };
    return query;
  } };
  function access(id, changes) {
    backend.current = backend.current.map(row => row.user_id === id ? { ...row, ...changes } : row);
    refresh();
  }
  return <>
    <div id="fixture-controls">
      <button onClick={() => { backend.current = backend.current.map(row => row.user_id === 'stale' ? { ...row, approved: true } : row); }}>Simulate concurrent approval</button>
      <button onClick={() => setFailNext(true)}>Simulate database failure</button>
      <button onClick={() => setClosed(true)}>Show removed access</button>
    </div>
    {closed ? <RemovedAccess busy={false} logout={() => setSignedOut(true)} />
      : <UsersPanel profile={initial[0]} profiles={profiles} supabase={client} busy={false} access={access} refresh={refresh}
          onRemoved={id => setProfiles(old => old.filter(row => row.user_id !== id))} />}
    <pre id="users-fixture-state">{JSON.stringify({ calls, signedOut, count: backend.current.length, removed: backend.current.filter(row => row.deleted_at).map(row => row.user_id) })}</pre>
  </>;
}
