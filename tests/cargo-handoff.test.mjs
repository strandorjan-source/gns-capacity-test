import test from 'node:test';
import assert from 'node:assert/strict';
import {cargoOrderUrl,openCargoOrder} from '../lib/cargo-handoff.mjs';
const vehicle={id:'11111111-1111-4111-8111-111111111111',reserved_at:'2026-10-06T18:20:00.123Z',phone:'private',customer:'private'};
test('Cargo handoff contains only reservation identity and targets the established Cargo app',()=>{
 const url=new URL(cargoOrderUrl(vehicle));assert.equal(url.origin,'https://gnscargo.vercel.app');assert.equal(url.pathname,'/app-fixed.html');
 assert.deepEqual([...url.searchParams.keys()],['capacity_vehicle','capacity_reservation']);assert.equal(url.searchParams.get('capacity_reservation'),vehicle.reserved_at);assert(!url.href.includes('private'));
 assert.throws(()=>cargoOrderUrl({id:vehicle.id}));
});
test('embedded Capacity posts to the exact same origin; standalone Capacity navigates to Cargo',()=>{
 let message,assigned;
 const embedded={location:{origin:'https://gnscargo.vercel.app',assign(){throw new Error('Unexpected navigation')}},parent:{postMessage:(data,origin)=>message={data,origin}}};
 openCargoOrder(vehicle,embedded);assert.equal(message.origin,embedded.location.origin);assert.deepEqual(message.data,{type:'gns-capacity-new-order',vehicleId:vehicle.id,reservedAt:vehicle.reserved_at});
 const standalone={location:{origin:'https://gns-capacity-test.vercel.app',assign:href=>assigned=href}};standalone.parent=standalone;
 openCargoOrder(vehicle,standalone);assert.equal(assigned,cargoOrderUrl(vehicle));
});
