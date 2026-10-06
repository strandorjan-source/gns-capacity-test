'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n-provider';
import { isAdmin, userMessage } from '../lib/capacity.mjs';
import { canRemoveCapacityProfile, removeCapacityProfile, visibleCapacityProfiles } from '../lib/users.mjs';
import { Modal } from './vehicle-components';

export function UsersPanel({ profiles, profile, supabase, busy, access, refresh, onRemoved }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const working = useRef(false);
  const blocked = Boolean(busy || removing);
  const entries = visibleCapacityProfiles(profiles);
  const currentTarget = selected && entries.find(entry => entry.user_id === selected.user_id);
  const removable = canRemoveCapacityProfile(profile, currentTarget);

  useEffect(() => {
    if (selected && !removable && !working.current) {
      setSelected(null);
      setError('Brukeren er allerede slettet eller har fått tilgang. Oppdater oversikten.');
    }
  }, [selected, removable]);

  async function confirmRemoval() {
    if (blocked || working.current || !removable) return;
    working.current = true; setRemoving(true); setError(''); setNotice('');
    try {
      const userId = await removeCapacityProfile(supabase, profile, currentTarget);
      setSelected(null);
      onRemoved?.(userId);
      setNotice('Brukeren eller forespørselen er slettet fra oversikten. Historikken er beholdt.');
      await refresh();
    } catch (failure) { setError(userMessage(failure)); }
    finally { working.current = false; setRemoving(false); }
  }

  if (!isAdmin(profile) || profile.deleted_at) return null;
  return <section className="wrap users">
    <div className="hero"><div><span className="eyebrow">{t('TILGANGSSTYRING')}</span><h1>{t('Brukere')}</h1>
      <p>{t('Godkjenn nye brukere og velg riktig rolle. Egen administratortilgang kan ikke fjernes her.')}</p>
      <p>{t('Du kan slette forespørsler og brukere uten tilgang. Trekk tilgangen før du sletter en aktiv bruker.')}</p>
    </div><button disabled={blocked} onClick={refresh}>{t('Oppdater')}</button></div>
    {notice && <div className="formnotice" role="status">{t(notice)}</div>}
    {error && !selected && <div className="formerror" role="alert">{t(error)}</div>}
    <div className="panel userlist">
      {entries.map(person => <div className="userrow" key={person.user_id} data-user-id={person.user_id}>
        <div><b>{person.full_name || t('Navn ikke registrert')}</b>
          <small>{person.email}{person.company ? ` · ${person.company}` : ''}</small>
          <small className="user-access-state">{t(person.approved ? 'Aktiv tilgang' : 'Uten tilgang')}</small>
          {(person.platform_superuser || person.platform_blocked) && <small>GNS Cargo</small>}
        </div>
        <select aria-label={t('Rolle for {name}', { name: person.full_name || person.email })}
          disabled={blocked || person.user_id === profile.user_id || person.platform_superuser || person.platform_blocked} value={person.role}
          onChange={event => access(person.user_id, { role: event.target.value })}>
          <option value="carrier">{t('Transportør')}</option><option value="dispatcher">{t('Dispatcher')}</option><option value="admin">{t('Admin')}</option>
        </select>
        <div className="user-actions">
          <button disabled={blocked || person.user_id === profile.user_id || person.platform_superuser || person.platform_blocked}
            className={person.approved ? 'dangerButton' : 'approveButton'}
            onClick={() => { setError(''); setNotice(''); access(person.user_id, { approved: !person.approved }); }}>
            {t(person.approved ? 'Trekk tilgang' : 'Godkjenn')}
          </button>
          {canRemoveCapacityProfile(profile, person) && <button disabled={blocked} className="dangerButton"
            aria-label={t('Slett {name}', { name: person.full_name || person.email })}
            onClick={() => { setError(''); setNotice(''); setSelected(person); }}>{t('Slett')}</button>}
        </div>
      </div>)}
      {!entries.length && <p className="empty">{t('Ingen brukere i oversikten.')}</p>}
    </div>
    {selected && <Modal title={t('Slett bruker eller forespørsel')} busy={blocked} message={error}
      onClose={() => { setSelected(null); setError(''); }}>
      <p>{t('Slette {name} fra brukeroversikten?', { name: selected.full_name || selected.email })}</p>
      <p><b>{selected.email}</b>{selected.company ? ` · ${selected.company}` : ''}</p>
      <p className="hint">{t('Brukeren fjernes fra oversikten. Bil-, lass- og reservasjonshistorikk beholdes. Brukeren får ikke tilgang ved å logge inn igjen.')}</p>
      <button className="dangerButton full" disabled={blocked || !removable} onClick={confirmRemoval}>
        {t(removing ? 'Sletter …' : 'Bekreft sletting')}
      </button>
    </Modal>}
  </section>;
}

export function RemovedAccess({ logout, busy }) {
  const { t } = useI18n();
  return <main className="authpage"><div className="authcard">
    <span className="eyebrow">GNS CAPACITY</span><h1>{t('Tilgangen er fjernet')}</h1>
    <p role="status">{t('GNS har slettet brukerforespørselen eller fjernet brukeren fra Capacity. Kontakt GNS dersom du trenger tilgang.')}</p>
    <button disabled={busy} className="primary full" onClick={logout}>{t('Logg ut')}</button>
  </div></main>;
}
