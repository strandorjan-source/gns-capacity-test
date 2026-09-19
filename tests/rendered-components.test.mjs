import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {blankVehicle} from '../lib/capacity.mjs';

// Use the project's installed compiler; no extra runtime or browser dependencies.
const require=createRequire(import.meta.url);
const {transformSync}=require('next/dist/compiled/babel/core');
const source=readFileSync(new URL('../app/vehicle-components.js',import.meta.url),'utf8')
  .replace('../lib/capacity.mjs',new URL('../lib/capacity.mjs',import.meta.url).href);
const {code}=transformSync(source,{filename:'vehicle-components.js',presets:[[require.resolve('next/babel'),{
  'preset-env':{modules:false,targets:{node:'24'}},'preset-react':{runtime:'automatic'},'transform-runtime':{helpers:false}
}]]});
const cache=new URL('../node_modules/.cache/capacity/',import.meta.url);
mkdirSync(cache,{recursive:true});
writeFileSync(new URL('components.mjs',cache),code);
const {VehicleTable,VehicleForm,EventLog}=await import(new URL('components.mjs',cache));
const base={id:'fixture',owner_user_id:'owner',carrier:'Test',registration:'AB12345',available_at:'2026-09-21T07:00:00Z',status:'Ledig',door_type:'Bakdører',location:'Oslo',vehicle_type:'Termo'};
const props={userId:'owner',busy:false,onAction(){},onEvents(){}};
const table=(role,row=base)=>renderToStaticMarkup(h(VehicleTable,{...props,profile:{role,approved:true},rows:[row]}));
test('admin has edit/delete/booking actions and sees doors',()=>{const html=table('admin');for(const s of ['Rediger','Slett','Reserver','Hendelser','Bakdører']) assert.ok(html.includes(s),s);});
test('dispatcher only has reservation and history controls',()=>{const html=table('dispatcher');assert.ok(!html.includes('Rediger')&&!html.includes('Slett')&&html.includes('Reserver'));});
test('carrier sees booking attribution without staff actions; comments are escaped',()=>{
 const html=table('carrier',{...base,status:'Reservert',reserved_by:'staff',reserved_at:'2026-09-19T10:00:00Z',reserved_by_name:'Staff Name',reservation_comment:'Customer <script>alert(1)</script>'});
 assert.ok(html.includes('Staff Name')&&html.includes('&lt;script&gt;')&&!html.includes('<script>'));
 assert.ok(!html.includes('>Frigi<')&&!html.includes('>Slett<'));
});
test('past rows cannot be reserved and deleted rows can be restored',()=>{
 const history=table('admin',{...base,is_history:true});assert.ok(history.includes('Passert dato')&&!history.includes('>Reserver<'));
 const deleted=table('admin',{...base,is_history:true,deleted_at:'2026-09-19T10:00:00Z'});assert.ok(deleted.includes('Gjenopprett')&&!deleted.includes('>Slett<')&&!deleted.includes('>Rediger<'));
});
test('vehicle form requires a separate door choice',()=>{const html=renderToStaticMarkup(h(VehicleForm,{form:blankVehicle,setForm(){},onSubmit(){},busy:false,submitLabel:'Save'}));assert.ok(html.includes('Dører / åpning')&&html.includes('Sideåpning og bakdører')&&html.includes('<select required=""'));});
test('release log keeps the previous load comment',()=>{const html=renderToStaticMarkup(h(EventLog,{events:[{id:1,action:'released',actor_name:'Staff',created_at:'2026-09-19T10:00:00Z',before_data:{reservation_comment:'Previous load'},after_data:{}}],loading:false}));assert.ok(html.includes('Frigitt')&&html.includes('Previous load'));});
