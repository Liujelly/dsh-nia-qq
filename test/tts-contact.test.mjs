import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TTS} from '../lib/tts.js';
import {Cooperation} from '../lib/cooperate.js';
import {Rhythm} from '../lib/rhythm.js';
import {Outbox} from '../lib/outbox.js';

function fixture(t) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nia-contact-tts-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const cfg={enabled:true,ttsEnabled:true,dryRun:false,cooperate:true,personaId:'nia',ttsDailyLimit:5};
 const c={key:'1:private:2',account:'1',active:true},source={key:'1:group:3',account:'1',active:true};
 const item={id:'intent-1',origin:source.key,target:c.key,personaId:'nia',preview:false,status:'pending',evidenceIds:[]};
 const b={config:()=>cfg,account:'1',ready:true,closed:false,abort:new AbortController(),media:{directory},turns:new Map(),store:{data:{inbox:[],intents:{[item.id]:item}},save(){}},sessions:{ensure:async()=>agent,wait:async()=>{},flush:async()=>{}},report(){}};
 b.rhythm=new Rhythm(b);b.cooperation=new Cooperation(b);b.cooperation.prepare=()=>({memory:{events:()=>[]},binding:{sessionId:'sid',chatId:'qq:'+c.key}});
 let calls=0; b.tts=new TTS(b,{key:()=> 'mock',fetchImpl:async()=>{calls++;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});}});
 let action=async()=>{};const agent={followup:async()=>action()};
 return {b,c,source,item,cfg,setAction:f=>action=f,calls:()=>calls};
}

test('host delivery authorizes contact once, survives restart, ends capability',async t=>{
 const f=fixture(t);let result;
 f.setAction(async()=>{result=await f.b.tts.synthesize(f.c,'hello','one');assert.equal(result.status,'completed');assert.equal((await f.b.tts.synthesize(f.c,'other','two')).status,'already_requested');});
 await f.b.cooperation.deliver(f.item,f.source,f.c);assert.equal(f.item.status,'handled');assert.equal(f.calls(),1);
 assert.throws(()=>f.b.tts.synthesize(f.c,'hello','one'));
 f.item.status='pending';f.b.store.data=JSON.parse(JSON.stringify(f.b.store.data));const restored=f.b.store.data.intents[f.item.id];
 f.setAction(async()=>assert.equal((await f.b.tts.synthesize(f.c,'hello','new')).status,'already_requested'));
 await f.b.cooperation.deliver(restored,f.source,f.c);assert.equal(f.calls(),1);
});
test('source label or forged turn cannot grant capability, altered target and state denied',async t=>{
 const f=fixture(t);f.b.turns.set(f.c.key,{qq:true,at:Date.now(),inputId:'nia-contact-'+f.item.id});
 assert.throws(()=>f.b.tts.synthesize(f.c,'x','a'));
 f.setAction(async()=>{const turn=f.b.turns.get(f.c.key);f.item.target='1:private:other';assert.throws(()=>f.b.tts.synthesize(f.c,'x','a'));f.item.target=f.c.key;f.item.status='uncertain';assert.throws(()=>f.b.tts.synthesize(f.c,'x','a'));f.item.status='delivering';f.cfg.dryRun=true;assert.throws(()=>f.b.tts.synthesize(f.c,'x','a'));f.cfg.dryRun=false;delete turn.contactVoice;assert.throws(()=>f.b.tts.synthesize(f.c,'x','a'));});
 await f.b.cooperation.deliver(f.item,f.source,f.c);assert.equal(f.calls(),0);
});
test('cancelled contact and incoming messages suppress late results without retry',async t=>{
 const f=fixture(t);let release;const gate=new Promise(r=>release=r);let calls=0;
 f.b.tts=new TTS(f.b,{key:()=> 'mock',fetchImpl:async()=>{calls++;await gate;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});}});
 f.setAction(async()=>{const p=f.b.tts.synthesize(f.c,'x','one');f.b.store.data.inbox.push({chat:f.c.key,status:'pending'});release();assert.equal((await p).status,'deferred');});
 await f.b.cooperation.deliver(f.item,f.source,f.c);assert.equal(calls,1);assert.equal(Object.values(f.b.store.data.ttsJobs)[0].status,'suppressed');
});
test('generated contact audio cannot be sent after its turn, including copied bytes and restart',async t=>{
 const f=fixture(t);let sent=0,file;f.cfg.cooperate=false;
 f.b.media.outbound=async source=>({data:{file:'base64://'+fs.readFileSync(source).toString('base64')}});
 f.b.media.save=(bytes)=>{const p=path.join(f.b.media.directory,'copy');fs.writeFileSync(p,bytes);return p;};
 f.b.store.data.actions={};f.b.action=async(c,id)=>{const key=`${c.key}:live:${id}`;if(f.b.store.data.actions[key])return {status:'confirmed',repeated:true};sent++;f.b.store.data.actions[key]={status:'confirmed'};return {status:'confirmed'};};f.b.outbox=new Outbox(f.b);
 f.setAction(async()=>{file=(await f.b.tts.synthesize(f.c,'hello','one')).file;const result=await f.b.outbox.send(f.c,'','send',{record:file});assert.equal(result.status,'confirmed');});
 await f.b.cooperation.deliver(f.item,f.source,f.c);assert.equal(sent,1);
 assert.equal((await f.b.outbox.send(f.c,'','send',{record:file})).repeated,true);assert.equal(sent,1);
 await assert.rejects(f.b.outbox.send(f.c,'','late',{record:file}),/过期/);
 await assert.rejects(f.b.outbox.send(f.c,'','copy',{record:path.join(f.b.media.directory,'copy')}),/过期/);
 f.b.store.data=JSON.parse(JSON.stringify(f.b.store.data));
 await assert.rejects(f.b.outbox.send(f.c,'','restart',{record:file}),/过期/);assert.equal(sent,1);
});
test('audio hash and path are durable before file creation; storage failures fail closed',async t=>{
 for(const failAt of [2,3]){
  const f=fixture(t);let saves=0,snapshot;
  f.setAction(async()=>{
   f.b.store.save=()=>{saves++;if(saves===failAt)throw Error('disk full');snapshot=JSON.parse(JSON.stringify(f.b.store.data));};
   assert.equal((await f.b.tts.synthesize(f.c,'hello','one')).status,'uncertain');
   const job=Object.values(f.b.store.data.ttsJobs)[0];assert.equal(fs.existsSync(job.file),failAt===3);
   if(failAt===3){const durable=Object.values(snapshot.ttsJobs)[0];assert.ok(durable.contactAudioHash);assert.ok(durable.file);assert.throws(()=>f.b.tts.validateRecord(f.c,Buffer.from('audio'),f.b.turns.get(f.c.key)),/过期/);}
   f.b.store.save=()=>{};
  });
  await f.b.cooperation.deliver(f.item,f.source,f.c);
 }
});
test('preview contact never calls API and pending incoming blocks before charging',async t=>{
 const f=fixture(t);f.cfg.dryRun=true;f.item.preview=true;
 f.setAction(async()=>{f.b.store.data.inbox.push({chat:f.c.key,status:'delivering'});assert.equal((await f.b.tts.synthesize(f.c,'x','one')).status,'deferred');f.b.store.data.inbox=[];assert.equal((await f.b.tts.synthesize(f.c,'x','one')).status,'preview');});
 await f.b.cooperation.deliver(f.item,f.source,f.c);assert.equal(f.calls(),0);
});
