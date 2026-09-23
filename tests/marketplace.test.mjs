import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditVehicle, filterVehicles, vehicleDates } from '../lib/capacity.mjs';
const rows = [
 {id:'past',status:'Ledig',available_at:'2026-09-20T10:00:00Z',is_history:true},
 {id:'a',status:'Ledig',available_at:'2026-09-21T21:59:00Z',carrier:'North',comment:'Sideåpning'},
 {id:'b',status:'Reservert',available_at:'2026-09-21T21:59:00Z',carrier:'North',reservation_comment:'Oslo–Bodø'},
 {id:'c',status:'Ledig',available_at:'2026-09-21T22:00:00Z',carrier:'South'},
 {id:'deleted',status:'Ledig',available_at:'2026-09-23T10:00:00Z',is_history:true,deleted_at:'2026-09-21T10:00:00Z'},
];
const ids = options => filterVehicles(rows,options).map(row=>row.id);
test('date dropdown deduplicates Norwegian dates and excludes history',()=>{
 assert.deepEqual(vehicleDates(rows),['2026-09-21','2026-09-22']);
 assert.deepEqual(vehicleDates(rows,true),['2026-09-23','2026-09-20']);
});
test('switching status keeps the same date and search scope',()=>{
 assert.deepEqual(ids({date:'2026-09-21',query:' north ',status:'Ledig'}),['a']);
 assert.deepEqual(ids({date:'2026-09-21',query:' north ',status:'Reservert'}),['b']);
 assert.deepEqual(ids({date:'2026-09-22',status:'Ledig'}),['c']);
 assert.deepEqual(ids({date:'2026-09-22',status:'Reservert'}),[]);
 assert.deepEqual(ids({date:'2026-09-25'}),[]);
});
test('clearing dates shows all matching active rows and keeps history separate',()=>{
 assert.deepEqual(ids({status:'Ledig'}),['a','c']);
 assert.deepEqual(ids({query:'oslo'}),['b']);
 assert.deepEqual(ids({history:true}),['deleted','past']);
 assert.deepEqual(ids({history:true,date:'2026-09-20'}),['past']);
 assert.equal(rows[0].id,'past');
});
test('carrier can edit own free or reserved vehicle, but not deleted or other-owned rows',()=>{
 const p={role:'carrier',approved:true}, row={owner_user_id:'a',status:'Ledig'};
 assert.equal(canEditVehicle(p,'a',row),true);
 assert.equal(canEditVehicle(p,'a',{...row,status:'Reservert',reserved_by:'staff'}),true);
 assert.equal(canEditVehicle(p,'b',row),false);
 assert.equal(canEditVehicle(p,null,row),false);
 assert.equal(canEditVehicle(p,'a',{...row,deleted_at:'now'}),false);
 assert.equal(canEditVehicle({...p,approved:false},'a',row),false);
 assert.equal(canEditVehicle({role:'dispatcher',approved:true},'a',row),false);
 assert.equal(canEditVehicle({role:'admin',approved:true},'b',row),true);
});

test('region filters the loading location independently of direction, date and status',()=>{
 const vehicles=[
  {id:'north',loading_region:'Nord-Norge',direction:'Sør-Norge',status:'Ledig',available_at:'2026-09-23T08:00:00Z'},
  {id:'south',loading_region:'Sør-Norge',direction:'Nord-Norge',status:'Ledig',available_at:'2026-09-23T08:00:00Z'},
  {id:'reserved',loading_region:'Nord-Norge',status:'Reservert',available_at:'2026-09-23T08:00:00Z'},
  {id:'unknown',loading_region:null,status:'Ledig',available_at:'2026-09-24T08:00:00Z'},
  {id:'past',loading_region:'Nord-Norge',status:'Ledig',available_at:'2026-09-20T08:00:00Z',is_history:true}
 ];
 const filtered=options=>filterVehicles(vehicles,options).map(v=>v.id);
 assert.deepEqual(filtered({region:'Nord-Norge',date:'2026-09-23',status:'Ledig'}),['north']);
 assert.deepEqual(filtered({region:'Nord-Norge',date:'2026-09-23',status:'Reservert'}),['reserved']);
 assert.deepEqual(filtered({region:'Sør-Norge'}),['south']);
 assert.deepEqual(filtered({region:'Nord-Norge',history:true}),['past']);
 assert.deepEqual(filtered({region:'unknown'}),['unknown']);
 assert.deepEqual(filtered({region:'Midt-Norge'}),[]);
 assert.deepEqual(filtered({region:'',status:'Ledig'}),['north','south','unknown']);
});
