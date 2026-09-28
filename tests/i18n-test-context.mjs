// Existing unit tests directly invoke stateless UI components to exercise their callbacks.
// Use the real production translation/formatting functions without calling React hooks.
// The real provider and language changes are covered separately by i18n-browser.sh.
import { translateText, localizedDate, localizedDay } from '../lib/i18n.mjs';
export function useI18n() {
  return {
    language: 'nb',
    t: (text, values) => translateText(text, 'nb', values),
    formatDate: value => localizedDate(value, 'nb'),
    dateOptionLabel: value => localizedDay(value, 'nb', true),
    loadDateLabel: value => localizedDay(value, 'nb'),
  };
}
