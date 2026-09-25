import test from 'node:test';
import assert from 'node:assert/strict';
import { blankLoad, loadChanges, loadForm, isCurrentLoad } from '../lib/loads.mjs';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const form={...blankLoad,pickup:' Bodø ',delivery:' Oslo ',loading_date:'2026-09-25',cargo:'Fisk, 33 paller',contact_name:'GNS',contact_phone:'12345678'};
test('load create/edit roundtrip preserves dates, optional fields and contact information',()=>{
 const changes=loadChanges({...form,loading_time:'12:30',delivery_date:'2026-09-26',vehicle_requirements:'Termo'});
 assert.equal(changes.pickup,'Bodø'); assert.equal(changes.delivery,'Oslo');
 assert.deepEqual(loadChanges(loadForm({...changes,loading_time:'12:30:00'})),changes);
 assert.equal(loadChanges(form).loading_time,null); assert.equal(loadChanges(form).delivery_date,null);
 assert.equal(loadForm({...changes,loading_time:null}).loading_time,'');
});
test('load validation rejects missing fields, invalid dates/times and reversed delivery dates',()=>{
 for(const key of ['pickup','delivery','cargo','contact_name','contact_phone']) assert.throws(()=>loadChanges({...form,[key]:' '}));
 for(const change of [{loading_date:'2026-02-30'},{loading_time:'25:00'},{delivery_date:'2026-09-24'},{comment:'x'.repeat(2001)},{cargo:'x'.repeat(301)}]) assert.throws(()=>loadChanges({...form,...change}));
 const payload=loadChanges({...form,id:'forged',created_by:'other',updated_by:'other',deleted_at:'now',created_at:'now'});
 for(const key of ['id','created_by','updated_by','deleted_at','created_at']) assert.ok(!(key in payload));
});
test('only current and undeleted loads belong in the active board',()=>{
 const row={loading_date:'2026-09-25'};
 assert.equal(isCurrentLoad(row,'2026-09-25'),true);
 assert.equal(isCurrentLoad(row,'2026-09-26'),false);
 assert.equal(isCurrentLoad({...row,deleted_at:'now'},'2026-09-25'),false);
});

const require=createRequire(import.meta.url);
const {transformSync}=require('next/dist/compiled/babel/core');
const source=readFileSync(new URL('../app/load-components.js',import.meta.url),'utf8')
 .replace('../lib/capacity.mjs',new URL('../lib/capacity.mjs',import.meta.url).href)
 .replace('../lib/loads.mjs',new URL('../lib/loads.mjs',import.meta.url).href);
const {code}=transformSync(source,{filename:'load-components.js',presets:[[require.resolve('next/babel'),{
 'preset-env':{modules:false,targets:{node:'24'}},'preset-react':{runtime:'automatic'},'transform-runtime':{helpers:false}
}]]});
const cache=new URL('../node_modules/.cache/capacity/',import.meta.url);mkdirSync(cache,{recursive:true});
writeFileSync(new URL('load-components.mjs',cache),code);
const {LoadForm,LoadList}=await import(new URL('load-components.mjs',cache));
const row={id:'load',...loadChanges(form),comment:'<script>unsafe</script>'};
const list=(role,approved=true,entry=row)=>renderToStaticMarkup(h(LoadList,{rows:[entry],profile:{role,approved},today:'2026-09-25',busy:false,onEdit(){},onRemove(){},onRestore(){}}));
test('all approved roles can read load details, while only admins see management buttons',()=>{
 for(const role of ['carrier','dispatcher','admin']) {
  const html=list(role); assert.ok(html.includes('Bodø')&&html.includes('Oslo')&&html.includes('Fisk, 33 paller')&&html.includes('tel:12345678'));
  assert.equal(html.includes('Rediger lass'),role==='admin'); assert.equal(html.includes('Fjern lass'),role==='admin');
  assert.ok(html.includes('&lt;script&gt;')&&!html.includes('<script>'));
 }
 assert.ok(!list('admin',false).includes('Rediger lass'));
 assert.ok(list('admin',true,{...row,deleted_at:'now'}).includes('Gjenopprett'));
});
test('admin form exposes the requested load fields and optional loading time',()=>{
 const html=renderToStaticMarkup(h(LoadForm,{form,setForm(){},onSubmit(){},busy:false,submitLabel:'Publiser lass'}));
 for(const label of ['Lastested','Leveringssted','Lastedato','Gods / omfang','Bilbehov','Kontaktperson hos GNS','Telefon','Publiser lass']) assert.ok(html.includes(label));
 assert.match(html,/<input type="time" value=""/);
});
