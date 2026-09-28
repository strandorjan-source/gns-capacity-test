'use client';
import { useI18n } from './i18n-provider';
export default function ErrorPage({ reset }) {
  const { t: _t, formatDate, dateOptionLabel, loadDateLabel } = useI18n();

  return <main className="authpage"><div className="authcard"><h1>{_t("GNS Capacity kunne ikke lastes")}</h1><p>{_t("En feil oppstod. Prøv igjen. Kontakt GNS dersom feilen vedvarer.")}</p><button className="primary full" onClick={reset}>{_t("Prøv igjen")}</button><a className="link" href="/">{_t("Til innlogging")}</a></div></main>;
}
