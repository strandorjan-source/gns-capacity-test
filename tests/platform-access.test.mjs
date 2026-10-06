import test from 'node:test';
import assert from 'node:assert/strict';
import { platformProfile } from '../lib/platform-access.mjs';

const user = { id: 'staff-id', email: 'staff@example.invalid' };
test('server-confirmed superusers get every existing Capacity admin capability', () => {
  const profile = platformProfile(user, { id: user.id, role: 'superuser', full_name: 'Test GNS' });
  assert.equal(profile.role, 'admin'); assert.equal(profile.approved, true);
  assert.equal(profile.platform_role, 'superuser'); assert.equal(profile.full_name, 'Test GNS');
});
test('Cargo-only roles preserve independent Capacity approval and roles', () => {
  for (const role of ['admin', 'dispatcher', 'pending', 'viewer']) assert.equal(platformProfile(user, { id: user.id, role }), null);
  assert.equal(platformProfile(user, null), null);
  assert.equal(platformProfile(user, { id: 'someone-else', role: 'superuser' }), null);
  assert.equal(platformProfile({ ...user, user_metadata: { role: 'superuser' } }, null), null);
});
test('platform removal or deactivation wins over any role', () => {
  for (const access of [{ blocked: true }, { deleted_at: '2026-10-06T12:00:00Z' }]) {
    const profile = platformProfile(user, { id: user.id, role: 'superuser', ...access });
    assert.equal(profile.platform_blocked, true); assert.equal(profile.approved, false);
  }
});

test('Capacity admin rows reflect platform access and hide deleted users', async () => {
 const { platformUsers } = await import('../lib/platform-access.mjs');
 const rows = [{user_id:'a',role:'carrier',approved:false},{user_id:'b',role:'admin',approved:true},{user_id:'c',role:'carrier',approved:true}];
 const result = platformUsers(rows,[{user_id:'a',platform_superuser:true},{user_id:'b',platform_blocked:true},{user_id:'c',platform_deleted:true}]);
 assert.equal(result.length,2);assert.equal(result[0].role,'admin');assert.equal(result[0].approved,true);assert.equal(result[1].approved,false);
 assert.equal(rows[0].role,'carrier');
});
