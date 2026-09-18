import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegistration, osloDateTime, vehiclePayload, blankVehicle, isStaff, isAdmin, canDeleteVehicle, authErrorFromUrl, withTimeout, formatDate } from '../lib/capacity.mjs';

test('registration is normalized consistently', () => assert.equal(normalizeRegistration(' yf - 22647 '), 'YF22647'));
test('invalid registration is rejected', () => { for (const v of ['', 'A', 'A/B', '<script>', 'A'.repeat(17)]) assert.throws(() => normalizeRegistration(v)); });
test('Norwegian summer time is converted to UTC', () => assert.equal(osloDateTime('2026-09-18', '17:00'), '2026-09-18T15:00:00.000Z'));
test('Norwegian winter time is converted to UTC', () => assert.equal(osloDateTime('2026-12-18', '17:00'), '2026-12-18T16:00:00.000Z'));
test('invalid calendar and time values are rejected', () => { for (const [d,t] of [['2026-02-30','12:00'],['2026-09-18','25:00'],['2026-13-18','12:00'],['','']]) assert.throws(() => osloDateTime(d,t)); });
test('spring daylight-saving gap is rejected', () => assert.throws(() => osloDateTime('2026-03-29', '02:30')));
test('ambiguous autumn hour is rejected', () => assert.throws(() => osloDateTime('2026-10-25', '02:30')));
test('dates render safely', () => { assert.deepEqual(formatDate('invalid'), ['Ikke angitt','']); assert.equal(formatDate('2026-09-18T15:00:00Z')[1], '17:00'); });
test('only approved staff have staff controls', () => { assert.equal(isStaff({role:'dispatcher',approved:true}),true); assert.equal(isStaff({role:'admin',approved:false}),false); assert.equal(isStaff({role:'carrier',approved:true}),false); assert.equal(isAdmin({role:'dispatcher',approved:true}),false); });
test('reserved vehicles cannot be deleted by carriers', () => { const p={role:'carrier',approved:true}; const row={owner_user_id:'a',status:'Ledig',reserved_by:null,reserved_at:null}; assert.equal(canDeleteVehicle(p,'a',row),true); assert.equal(canDeleteVehicle(p,'b',row),false); assert.equal(canDeleteVehicle(p,'a',{...row,status:'Reservert'}),false); assert.equal(canDeleteVehicle({...p,approved:false},'a',row),false); });
test('query and fragment OAuth failures are shown without leaking codes', () => { for (const suffix of ['?error=server_error&error_description=SECRET','#error=server_error&error_description=SECRET']) { const m=authErrorFromUrl(`https://gns-capacity-test.vercel.app/${suffix}`); assert.ok(m.includes('Microsoft')); assert.ok(!m.includes('SECRET')); } assert.equal(authErrorFromUrl('https://gns-capacity-test.vercel.app/'),''); });
test('OAuth cancellation has actionable message', () => assert.match(authErrorFromUrl('https://example.test/?error=access_denied'), /avbrutt/));
test('vehicle payload never grants reservations or substitutes owner', () => { const p=vehiclePayload({...blankVehicle,carrier:' Test ',contact:'Name',phone:'123',registration:'AB 12345',date:'2026-09-18',time:'17:00',owner_user_id:'attacker',status:'Reservert'},'actual'); assert.equal(p.owner_user_id,'actual'); assert.equal(p.status,'Ledig'); assert.equal(p.reserved_by,null); assert.equal(p.registration,'AB12345'); assert.equal(p.carrier,'Test'); });
test('vehicle requires login and required fields', () => { assert.throws(() => vehiclePayload(blankVehicle,null)); assert.throws(() => vehiclePayload(blankVehicle,'a')); });
test('timeout prevents endless loading', async () => { await assert.rejects(withTimeout(new Promise(()=>{}),5),/lang tid/); assert.equal(await withTimeout(Promise.resolve(42),50),42); });
