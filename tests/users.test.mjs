import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canRemoveCapacityProfile, visibleCapacityProfiles, removeCapacityProfile } from '../lib/users.mjs';
import { dictionaries, languages } from '../lib/i18n.mjs';

const admin = { user_id: 'admin', role: 'admin', approved: true };
const pending = { user_id: 'pending', role: 'carrier', approved: false };

test('only an active administrator may remove another inactive profile', () => {
  assert.equal(canRemoveCapacityProfile(admin, pending), true);
  assert.equal(canRemoveCapacityProfile(admin, { ...pending, role: 'admin' }), true);
  for (const actor of [null, {}, { ...admin, approved: false }, { ...admin, role: 'dispatcher' }, { ...admin, role: 'carrier' }, { ...admin, deleted_at: 'now' }]) assert.equal(canRemoveCapacityProfile(actor, pending), false);
  for (const target of [null, {}, admin, { ...pending, user_id: 'admin' }, { ...pending, approved: true }, { ...pending, approved: undefined }, { ...pending, deleted_at: 'now' }]) assert.equal(canRemoveCapacityProfile(admin, target), false);
});

test('removed profiles stay out of user administration without mutating input', () => {
  const entries = [admin, pending, { ...pending, user_id: 'removed', deleted_at: 'now' }];
  assert.deepEqual(visibleCapacityProfiles(entries), [admin, pending]);
  assert.equal(entries.length, 3);
});

function mockClient(result) {
  const calls = [];
  const query = {};
  for (const method of ['from', 'update', 'eq', 'is', 'select']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.maybeSingle = async () => result;
  return { client: query, calls };
}

test('removal targets one inactive profile atomically and never deletes the auth account', async () => {
  const { client, calls } = mockClient({ data: { user_id: 'pending' }, error: null });
  assert.equal(await removeCapacityProfile(client, admin, pending), 'pending');
  assert.deepEqual(calls[0], ['from', 'capacity_profiles']);
  assert.deepEqual(Object.keys(calls[1][1]), ['deleted_at']);
  assert.ok(Number.isFinite(Date.parse(calls[1][1].deleted_at)));
  assert.deepEqual(calls.slice(2), [['eq', 'user_id', 'pending'], ['eq', 'approved', false], ['is', 'deleted_at', null], ['select', 'user_id']]);
});

test('unauthorized deletion never calls the client', async () => {
  const { client, calls } = mockClient({ data: {} });
  await assert.rejects(removeCapacityProfile(client, { ...admin, role: 'carrier' }, pending));
  await assert.rejects(removeCapacityProfile(client, admin, admin));
  await assert.rejects(removeCapacityProfile(client, admin, { ...pending, approved: true }));
  assert.equal(calls.length, 0);
});

test('stale approval and database errors never report successful deletion', async () => {
  await assert.rejects(removeCapacityProfile(mockClient({ data: null, error: null }).client, admin, pending), /allerede slettet eller har fått tilgang/);
  const error = new Error('Database unavailable');
  await assert.rejects(removeCapacityProfile(mockClient({ data: null, error }).client, admin, pending), error);
});

test('new user-interface strings exist in all seven dictionaries', () => {
  const component = readFileSync(new URL('../app/user-components.js', import.meta.url), 'utf8');
  const keys = [...component.matchAll(/t\('([^']+)'/g)].map(match => match[1]);
  for (const language of languages) for (const key of keys) assert.ok(dictionaries[language.code].has(key), `${language.code}: ${key}`);
});

test('page keeps removed users blocked and excludes them from admin reads', () => {
  const source = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.match(source, /if \(profile\?\.deleted_at\) return <RemovedAccess/);
  assert.ok(source.indexOf('if (profile?.deleted_at)') < source.indexOf('if (!profile?.approved)'));
  assert.match(source, /from\('capacity_profiles'\)\.select\('\*'\)\.is\('deleted_at', null\)/);
  assert.match(source, /if \(existing\.data\) return existing\.data/);
});
