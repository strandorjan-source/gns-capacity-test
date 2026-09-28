import { labelRows } from './i18n-labels.mjs';
import { messageRows } from './i18n-messages.mjs';

export const DEFAULT_LANGUAGE = 'nb';
export const LANGUAGE_STORAGE_KEY = 'gns-capacity-language';
export const languages = Object.freeze([
  { code: 'nb', name: 'Norsk (standard)', locale: 'nb-NO' },
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'da', name: 'Dansk', locale: 'da-DK' },
  { code: 'sv', name: 'Svenska', locale: 'sv-SE' },
  { code: 'nl', name: 'Nederlands', locale: 'nl-NL' },
]);
export const normalizeLanguage = value => languages.some(item => item.code === value) ? value : DEFAULT_LANGUAGE;
export const localeFor = language => languages.find(item => item.code === normalizeLanguage(language)).locale;
export const dictionaries = Object.fromEntries(languages.map(item => [item.code, new Map()]));
for (const line of `${labelRows}\n${messageRows}`.split('\n').filter(line => line.trim())) {
  const columns = line.split('|').map(column => column.trim());
  if (columns.length !== 7 || columns.some(column => !column)) throw new Error(`Invalid translation row: ${columns[0]}`);
  languages.forEach((item, index) => dictionaries[item.code].set(columns[0], columns[index]));
}

/** Only call for UI text or whitelisted system enums, never arbitrary customer data. */
export function translateText(source, language = DEFAULT_LANGUAGE, values = {}) {
  if (typeof source !== 'string' || !source) return source;
  const code = normalizeLanguage(language);
  const key = source.trim().replace(/\s+/g, ' ');
  let translated = dictionaries[code].get(key);
  if (translated === undefined && code !== 'nb') {
    // Validation stays Norwegian internally. Translate only the known message shapes.
    let match = key.match(/^(.+) må fylles ut og kan ha maksimalt (\d+) tegn\.$/);
    if (match) return translateText('{label} må fylles ut og kan ha maksimalt {max} tegn.', code, { label: translateText(match[1], code), max: match[2] });
    match = key.match(/^(.+) kan ha maksimalt (\d+) tegn\.$/);
    if (match) return translateText('{label} kan ha maksimalt {max} tegn.', code, { label: translateText(match[1], code), max: match[2] });
    match = key.match(/^Fyll ut (.+)\.$/);
    if (match) {
      const label = match[1][0].toUpperCase() + match[1].slice(1);
      if (dictionaries.nb.has(label)) return translateText('Fyll ut {label}.', code, { label: translateText(label, code) });
    }
  }
  translated ??= source.trim();
  const result = translated.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, name) => Object.hasOwn(values, name) ? String(values[name]) : token);
  return `${source.match(/^\s*/)[0]}${result}${source.match(/\s*$/)[0]}`;
}

export function localizedDate(value, language = DEFAULT_LANGUAGE) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return [translateText('Ikke angitt', language), ''];
  const locale = localeFor(language);
  return [new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'Europe/Oslo' }).format(date),
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Oslo' }).format(date)];
}
export function localizedDay(value, language = DEFAULT_LANGUAGE, weekday = false) {
  const date = new Date(`${value}T12:00:00Z`);
  if (!value || !Number.isFinite(date.getTime())) return translateText('Ikke angitt', language);
  return new Intl.DateTimeFormat(localeFor(language), { ...(weekday ? { weekday: 'short' } : {}), day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Oslo' }).format(date);
}
