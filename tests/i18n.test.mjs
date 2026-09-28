import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { languages, dictionaries, normalizeLanguage, translateText, localizedDate, localizedDay } from '../lib/i18n.mjs';
import { vehicleChanges, blankVehicle, doorTypes, loadingRegions } from '../lib/capacity.mjs';

test('exactly the seven requested languages with Norwegian as default', () => {
  assert.deepEqual(languages.map(item => item.code), ['nb', 'en', 'de', 'fr', 'da', 'sv', 'nl']);
  for (const invalid of [undefined, null, '', 'xx', '__proto__', 'en-US']) assert.equal(normalizeLanguage(invalid), 'nb');
  assert.equal(translateText('Meld inn ledig bil'), 'Meld inn ledig bil');
});
test('every dictionary row is present in all languages with matching interpolation parameters', () => {
  const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const [key, source] of dictionaries.nb) for (const { code } of languages) {
    assert.ok(dictionaries[code].get(key), `${code}: ${key}`);
    assert.deepEqual(parameters(dictionaries[code].get(key)), parameters(source), `${code}: ${key}`);
  }
});
test('every UI source key extracted during migration is translated', () => {
  const keys = JSON.parse(readFileSync(new URL('./i18n-source-keys.json', import.meta.url)));
  for (const key of keys) for (const { code } of languages) assert.ok(dictionaries[code].has(key), `${code}: ${key}`);
});
test('known errors, preserved whitespace and safe placeholders', () => {
  assert.equal(translateText(' Ledig ', 'en'), ' Available ');
  assert.equal(translateText('Transportør må fylles ut og kan ha maksimalt 200 tegn.', 'en'), 'Carrier is required and must not exceed 200 characters.');
  assert.equal(translateText('Fyll ut telefon.', 'en'), 'Please fill in Phone.');
  assert.equal(translateText('unrecognized customer text', 'fr'), 'unrecognized customer text');
  assert.equal(translateText('Fyll ut {label}.', 'nl', { label: '<script>TEST</script>' }), 'Vul <script>TEST</script> in.');
});
test('translated dates retain the Norwegian timezone and 24-hour clock', () => {
  for (const { code } of languages) {
    assert.equal(localizedDate('2026-09-28T22:30:00Z', code)[1], '00:30');
    assert.equal(localizedDate('2026-12-28T22:30:00Z', code)[1], '23:30');
    assert.ok(localizedDay('2026-09-29', code));
    assert.equal(localizedDate(null, code)[0], translateText('Ikke angitt', code));
  }
});
test('UI languages cannot change payload enums, free text, registration or time', () => {
  const form = { ...blankVehicle, carrier: 'Ledig', contact: 'Historikk', phone: '+4712345678', registration: 'TEST 88', trailer_number: 'TR-123', location: 'Oslo', loading_region: 'Utlandet', date: '2026-10-10', time: '08:30', vehicle_type: 'Termo', door_type: 'Sideåpning og bakdører', comment: 'Sideåpning' };
  const expected = vehicleChanges(form);
  for (const { code } of languages) {
    doorTypes.forEach(value => assert.ok(translateText(value, code)));
    loadingRegions.forEach(value => assert.ok(translateText(value, code)));
    assert.deepEqual(vehicleChanges(form), expected);
  }
  assert.equal(expected.available_at, '2026-10-10T06:30:00.000Z');
  assert.equal(expected.carrier, 'Ledig');
  assert.equal(expected.door_type, 'Sideåpning og bakdører');
});
