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
const {VehicleTable,VehicleForm,EventLog,CapacityFilters,VehicleTypeTabs}=await import(new URL('components.mjs',cache));
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
test('vehicle form offers equipment choices and requires the loading region',()=>{const html=renderToStaticMarkup(h(VehicleForm,{form:{...blankVehicle,door_type:'Maskinsemi',loading_region:'Nord-Norge'},setForm(){},onSubmit(){},busy:false,submitLabel:'Save'}));assert.ok(html.includes('Dører / tilvalg')&&html.includes('Sideåpning og bakdører')&&html.includes('<select required=""')); for (const label of ['Åpen semi','Flisbil','Maskinsemi','Landsdel klar for lasting','Midt-Norge','Sør-Norge','Utlandet']) assert.ok(html.includes(label),label); assert.match(html, /<option selected="">Maskinsemi<\/option>/); assert.match(html, /<option selected="">Nord-Norge<\/option>/);});
test('release log keeps the previous load comment',()=>{const html=renderToStaticMarkup(h(EventLog,{events:[{id:1,action:'released',actor_name:'Staff',created_at:'2026-09-19T10:00:00Z',before_data:{reservation_comment:'Previous load'},after_data:{}}],loading:false}));assert.ok(html.includes('Frigitt')&&html.includes('Previous load'));});

test('carrier edit control appears only on own nondeleted rows, including reservations',()=>{
 assert.ok(table('carrier').includes('>Rediger<'));
 assert.ok(table('carrier',{...base,status:'Reservert'}).includes('>Rediger<'));
 assert.ok(!table('carrier',{...base,owner_user_id:'other'}).includes('>Rediger<'));
 assert.ok(!table('carrier',{...base,deleted_at:'now'}).includes('>Rediger<'));
});
test('marketplace renders status tabs and a persistent selected date',()=>{
 const html=renderToStaticMarkup(h(CapacityFilters,{history:false,dates:['2026-09-21'],date:'2026-09-22',status:'Reservert',counts:{Ledig:3,Reservert:2},region:'Nord-Norge',onRegion(){},onDate(){},onStatus(){}}));
 assert.ok(html.includes('role="tablist"')&&html.includes('Ledige biler')&&html.includes('Reserverte biler'));
 assert.match(html,/id="tab-reserved"[^>]*aria-selected="true"/);
 assert.match(html,/<option value="2026-09-22" selected=""/);
 assert.ok(html.includes('Alle datoer')&&html.includes('Vis alle datoer')); assert.ok(html.includes('Klar for lasting i')&&html.includes('Alle landsdeler')&&html.includes('Ikke oppgitt')); assert.match(html, /<option selected="">Nord-Norge<\/option>/);
 const history=renderToStaticMarkup(h(CapacityFilters,{history:true,dates:[],date:'',onDate(){}}));
 assert.ok(!history.includes('role="tab"')&&history.includes('Ledigdato'));
});


test('type tabs identify the selected category, count and result panel',()=>{
 const html=renderToStaticMarkup(h(VehicleTypeTabs,{selected:'machine',counts:{all:7,machine:2},onSelect(){}}));
 for(const text of ['Alle biltyper','Termo','Express','Standard','Bakdører','Sideåpning','Åpen semi','Flisbil','Maskinsemi']) assert.ok(html.includes(text));
 assert.match(html,/id="type-tab-machine"[^>]*aria-selected="true"[^>]*aria-controls="vehicle-type-results"[^>]*tabindex="0"/);
 assert.ok(html.includes('Maskinsemi<span>2</span>'));
 assert.equal((html.match(/tabindex="0"/g)||[]).length,1);
});
test('type tabs support click, arrow wrap and Home/End navigation',()=>{
 let selected,focused;
 const tabs=VehicleTypeTabs({selected:'machine',counts:{},onSelect(value){selected=value;}}).props.children;
 tabs.find(tab=>tab.props.id==='type-tab-open').props.onClick(); assert.equal(selected,'open');
 const active=tabs.find(tab=>tab.props.id==='type-tab-machine');
 const key=key=>active.props.onKeyDown({key,preventDefault(){},currentTarget:{parentElement:{querySelector(selector){return {focus(){focused=selector;}};}}}});
 key('ArrowRight'); assert.equal(selected,'all'); assert.equal(focused,'#type-tab-all');
 key('ArrowLeft'); assert.equal(selected,'chips');
 key('Home'); assert.equal(selected,'all'); key('End'); assert.equal(selected,'machine');
});


test('carrier has an all-vehicles summary with available and reserved counts',()=>{
 const props={history:false,dates:[],date:'',region:'',onDate(){},onRegion(){},onStatus(){},status:'Alle',counts:{Alle:5,Ledig:2,Reservert:3},ownOverview:true};
 const html=renderToStaticMarkup(h(CapacityFilters,props));
 assert.match(html,/id="tab-mine"[^>]*aria-selected="true"/);
 assert.ok(html.includes('Alle mine biler<span>5</span>')&&html.includes('Reserverte biler<span>3</span>'));
 const staff=renderToStaticMarkup(h(CapacityFilters,{...props,ownOverview:false,status:'Ledig'}));
 assert.ok(!staff.includes('Alle mine biler'));
});
