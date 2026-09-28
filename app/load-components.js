'use client';
import { useI18n } from './i18n-provider';
import { isAdmin, osloDate, formatDate } from '../lib/capacity.mjs';
import { isCurrentLoad, loadDateLabel } from '../lib/loads.mjs';

const Field = ({ label, children }) => { const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n(); return (<label>{_t(label)}{children}</label>); };
export function LoadForm({ form, setForm, onSubmit, busy, submitLabel }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  const field = name => ({ value: form[name], onChange: event => setForm(old => ({ ...old, [name]: event.target.value })) });
  return <form onSubmit={onSubmit} className="load-form">
    <div className="two">
      <Field label={_t("Lastested")}><input required maxLength={200} {...field('pickup')} placeholder={_t("F.eks. Sørarnøy")} /></Field>
      <Field label={_t("Leveringssted")}><input required maxLength={200} {...field('delivery')} placeholder={_t("F.eks. Oslo")} /></Field>
    </div>
    <div className="two">
      <Field label={_t("Lastedato")}><input type="date" required {...field('loading_date')} /></Field>
      <Field label={_t("Lastetid i norsk tid (valgfritt)")}><input type="time" {...field('loading_time')} /></Field>
    </div>
    <Field label={_t("Leveringsdato (valgfritt)")}><input type="date" min={form.loading_date || undefined} {...field('delivery_date')} /></Field>
    <Field label={_t("Gods / omfang")}><input required maxLength={300} {...field('cargo')} placeholder={_t("F.eks. fersk fisk, 33 paller / 20 tonn")} /></Field>
    <Field label={_t("Bilbehov (valgfritt)")}><input maxLength={200} {...field('vehicle_requirements')} placeholder={_t("F.eks. termo med bakdører, ekspress")} /></Field>
    <div className="two">
      <Field label={_t("Kontaktperson hos GNS")}><input required maxLength={200} {...field('contact_name')} /></Field>
      <Field label={_t("Telefon")}><input type="tel" required maxLength={50} {...field('contact_phone')} /></Field>
    </div>
    <Field label={_t("Kommentar (valgfritt)")}><textarea maxLength={2000} {...field('comment')} placeholder={_t("F.eks. temperaturkrav, tidsvindu eller annen nyttig informasjon")} /></Field>
    <p className="hint">{_t("Opplysningene blir synlige for alle godkjente transportører. Lass med passert lastedato vises under tidligere lass hos admin.")}</p>
    <button className="primary full" disabled={busy}>{busy ? _t('Lagrer …') : _t(submitLabel)}</button>
  </form>;
}

export function LoadList({ rows, profile, busy, onEdit, onRemove, onRestore, onInterest, interestBusyId, today = osloDate() }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  const admin = isAdmin(profile);
  const carrier = Boolean(profile?.approved && profile.role === 'carrier');
  return <div className="load-list">{rows.map(row => {
    const active = isCurrentLoad(row, today);
    const ownInterest = row.interests?.find(interest => interest.user_id === profile?.user_id);
    const interested = Boolean(ownInterest?.interested);
    const responses = (row.interests || []).filter(interest => interest.interested);
    const phone = row.contact_phone.replace(/[^+\d]/g, '');
    return <article className={`load-card${active ? '' : ' load-closed'}`} key={row.id}>
      <div className="load-route"><span className={`load-status${active ? '' : ' inactive'}`}>{row.deleted_at ? _t('Fjernet') : active ? _t('Ledig lass') : _t('Passert lastedato')}</span><h2>{row.pickup} <span aria-label={_t("til")}>→</span> {row.delivery}</h2></div>
      <dl className="load-details">
        <div><dt>{_t("Lasting")}</dt><dd>{loadDateLabel(row.loading_date)}{row.loading_time ? `${_t(" kl. ")}${row.loading_time.slice(0, 5)}` : _t(' · Tid avtales')}</dd></div>
        <div><dt>{_t("Levering")}</dt><dd>{row.delivery_date ? loadDateLabel(row.delivery_date) : _t('Etter avtale')}</dd></div>
        <div><dt>{_t("Gods / omfang")}</dt><dd>{row.cargo}</dd></div>
        <div><dt>{_t("Bilbehov")}</dt><dd>{row.vehicle_requirements || _t('Etter avtale')}</dd></div>
      </dl>
      {row.comment && <p className="load-comment multiline">{row.comment}</p>}
      <div className="load-bottom"><div><span>{_t("Kontakt GNS for dette lasset")}</span><strong>{row.contact_name}</strong>{phone ? <a href={`tel:${phone}`}>{row.contact_phone}</a> : <span>{row.contact_phone}</span>}</div>
        {carrier && active && <div className="load-interest-action">
          {interested && <p role="status">{_t("✓ Interesse meldt")}</p>}
          <button className={interested ? 'interest-withdraw' : 'primary'} disabled={busy} onClick={() => onInterest(row)}>
            {interestBusyId === row.id ? _t('Lagrer …') : interested ? _t('Trekk interesse') : _t('Interessert')}
          </button>
          <small>{interested ? _t('GNS ser interessen din og kan kontakte deg.') : _t('Meld interesse til GNS. Transporten avtales med kontaktpersonen.')}</small>
        </div>}
        {admin && <div className="load-actions"><button disabled={busy} onClick={() => onEdit(row)}>{_t("Rediger lass")}</button>{row.deleted_at ? <button disabled={busy} onClick={() => onRestore(row)}>{_t("Gjenopprett")}</button> : <button disabled={busy} className="delete-button" onClick={() => onRemove(row)}>{_t("Fjern lass")}</button>}</div>}
      </div>
      {admin && <div className="load-interests"><h3>{_t("Interesserte transportører ")}<span>{responses.length}</span></h3>
        {responses.length ? <ul>{responses.map(interest => <li key={interest.user_id}>
          <div><strong>{interest.person?.company || _t('Firma ikke oppgitt')}</strong><span>{interest.person?.full_name || _t('Navn ikke oppgitt')}</span>{interest.person?.email && <span>{interest.person.email}</span>}</div>
          <time dateTime={interest.updated_at}>{formatDate(interest.updated_at).join(' · ')}</time>
        </li>)}</ul> : <p>{_t("Ingen har meldt interesse ennå.")}</p>}
      </div>}
    </article>;
  })}</div>;
}
