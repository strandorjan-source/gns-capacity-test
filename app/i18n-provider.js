'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, languages, normalizeLanguage, translateText, localizedDate, localizedDay } from '../lib/i18n.mjs';

const defaults = {
  language: DEFAULT_LANGUAGE,
  t: (text, values) => translateText(text, DEFAULT_LANGUAGE, values),
  formatDate: value => localizedDate(value),
  dateOptionLabel: value => localizedDay(value, DEFAULT_LANGUAGE, true),
  loadDateLabel: value => localizedDay(value),
};
const I18nContext = createContext(defaults);
export const useI18n = () => useContext(I18nContext);

export default function I18nProvider({ children }) {
  // The server and first browser render are always Norwegian. Never infer from browser locale.
  const [language, setLanguageState] = useState(DEFAULT_LANGUAGE);
  useEffect(() => {
    try { setLanguageState(normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY))); } catch { /* Storage can be disabled; the selector still works. */ }
    const sync = event => { if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) setLanguageState(normalizeLanguage(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const setLanguage = useCallback(value => {
    const next = normalizeLanguage(value);
    setLanguageState(next);
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Session-only preference. */ }
  }, []);
  const context = useMemo(() => ({
    language, setLanguage,
    t: (text, values) => translateText(text, language, values),
    formatDate: value => localizedDate(value, language),
    dateOptionLabel: value => localizedDay(value, language, true),
    loadDateLabel: value => localizedDay(value, language),
  }), [language, setLanguage]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-gns-required-message]').forEach(field => {
      field.setCustomValidity(field.validity.valueMissing ? context.t('Fyll ut dette feltet.') : '');
    });
  }, [language, context]);
  function invalid(event) {
    const field = event.target;
    if (typeof field.setCustomValidity === 'function' && field.validity.valueMissing) {
      field.dataset.gnsRequiredMessage = 'true';
      field.setCustomValidity(context.t('Fyll ut dette feltet.'));
    }
  }
  function clearValidity(event) {
    if (event.target.dataset?.gnsRequiredMessage) {
      event.target.setCustomValidity('');
      delete event.target.dataset.gnsRequiredMessage;
    }
  }
  return <I18nContext.Provider value={context}>
    <div className="gns-localized-app" onInvalidCapture={invalid} onInputCapture={clearValidity} onChangeCapture={clearValidity}>
      <div className="gns-language-bar">
        <span className="gns-language-brand">GNS Capacity</span>
        <label htmlFor="gns-language-select"><span aria-hidden="true">◎</span><span>{context.t('Språk')} / Language</span>
          <select id="gns-language-select" data-testid="language-select" aria-label="Språk / Language" value={language} onChange={event => setLanguage(event.target.value)}>
            {languages.map(item => <option key={item.code} value={item.code} lang={item.code}>{item.name}</option>)}
          </select>
        </label>
      </div>
      {children}
    </div>
  </I18nContext.Provider>;
}
