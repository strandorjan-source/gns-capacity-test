'use client';
// CI-only fixture: copied into app for testing, never committed as a production route.
import { useState } from 'react';
import { VehicleForm, VehicleTable } from '../vehicle-components';
import { LoadList } from '../load-components';
import { useI18n } from '../i18n-provider';
import { blankVehicle, vehicleChanges } from '../../lib/capacity.mjs';
export default function LanguageFixture() {
  const { t } = useI18n();
  const [form, setForm] = useState({ ...blankVehicle, carrier: 'Ledig', contact: 'Historikk', phone: '+4712345678', registration: 'TEST 88', trailer_number: 'TR-123', location: 'Oslo', loading_region: 'Utlandet', date: '2026-10-10', time: '08:30', vehicle_type: 'Termo', door_type: 'Sideåpning og bakdører', comment: 'Sideåpning' });
  const [saved, setSaved] = useState(null), [error, setError] = useState('');
  const profile = { approved: true, role: 'carrier', user_id: 'fixture-user' };
  const row = { id: 'fixture-vehicle', ...vehicleChanges(form.registration.length > 1 ? { ...form, carrier: form.carrier || 'Ledig' } : { ...form, registration: 'TEST88', carrier: form.carrier || 'Ledig' }), carrier: 'Ledig', contact: 'Historikk', comment: 'Sideåpning', status: 'Reservert', owner_user_id: 'fixture-user', reserved_at: '2026-09-28T22:30:00Z', reserved_by_name: 'Frigi', reservation_comment: 'Ledig' };
  function submit(event) { event.preventDefault(); try { setSaved(vehicleChanges(form)); setError(''); } catch (failure) { setError(failure.message); } }
  return <main>
    <section className="formpage" id="fixture-form"><div className="formcard"><h1>{t('Meld inn ledig bil')}</h1>
      <VehicleForm form={form} setForm={setForm} onSubmit={submit} busy={false} submitLabel={t('Meld inn ledig bil')} />
      <output id="fixture-saved">{saved ? JSON.stringify(saved) : ''}</output><p id="fixture-error">{t(error)}</p>
    </div></section>
    <section className="wrap"><VehicleTable rows={[row]} profile={profile} userId="fixture-user" busy={false} onAction={() => {}} onEvents={() => {}} /></section>
    <section className="wrap"><LoadList rows={[{ id: 'fixture-load', loading_date: '2099-01-01', loading_time: '08:30', pickup: 'Oslo', delivery: 'Bodø', cargo: 'Sideåpning', contact_name: 'Historikk', contact_phone: '+4712345678', interests: [] }]} profile={profile} busy={false} onInterest={() => setSaved({ interested: true })} /></section>
  </main>;
}
