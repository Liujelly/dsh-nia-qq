import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TTS} from '../lib/tts.js';
import {validateConfig,defaults} from '../lib/index.js';

function fixture(t,overrides={}) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nia-tts-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const cfg={...defaults,enabled:true,ttsEnabled:true,dryRun:false,...overrides};
 const b={config:()=>cfg,ready:true,closed:false,account:'123',abort:new AbortController(),media:{directory},store:{data:{inbox:[]},save(){}}};
 const c={key:'123:private:456',account:'123',active:true};b.turns=new Map([[c.key,{qq:true,voiceRequestId:'1',at:Date.now()}]]);return {b,c,cfg};
}
test('disabled, preview and validation do not invoke API',async t=>{
 const {b,c,cfg}=fixture(t,{ttsEnabled:false});let calls=0;const tts=new TTS(b,{key:()=> 'secret',fetchImpl:()=>{calls++;}});
 assert.throws(()=>tts.synthesize(c,'hi','a'),/未启用/);cfg.ttsEnabled=true;cfg.dryRun=true;
 assert.equal((await tts.synthesize(c,'hi','a')).status,'preview');assert.throws(()=>tts.synthesize(c,'x'.repeat(201),'b'),/长度/);assert.equal(calls,0);
 assert.throws(()=>validateConfig({ttsDailyLimit:0}),/范围/);
});
test('one request for concurrent duplicate, quota and payload',async t=>{
 const {b,c}=fixture(t,{ttsDailyLimit:1});let calls=0,release;const gate=new Promise(r=>release=r);
 const tts=new TTS(b,{key:()=> 'secret',fetchImpl:async(url,opts)=>{calls++;assert.match(url,/voc_8yud7hz7c9q2/);assert.equal(opts.headers['xi-api-key'],'secret');assert.deepEqual(JSON.parse(opts.body),{text:'你好',model_id:'breeze-tts-2'});await gate;return new Response(Buffer.from('mp3'),{headers:{'content-type':'audio/mpeg'}});}});
 const a=tts.synthesize(c,'你好','one'),second=tts.synthesize(c,'你好','one');assert.equal((await tts.synthesize(c,'other','two')).status,'already_requested');b.turns.get(c.key).voiceRequestId='2';assert.equal((await tts.synthesize(c,'other','two')).status,'limited');assert.throws(()=>tts.synthesize(c,'你好','one'),/不能跨轮复用/);b.turns.get(c.key).voiceRequestId='1';release();const result=await a;assert.equal(result.status,'completed');assert.equal((await second).file,result.file);assert.equal(calls,1);assert.equal((await tts.synthesize(c,'你好','one')).repeated,true);assert.throws(()=>tts.synthesize(c,'changed','one'),/不同合成/);
});
test('failure and persisted pending fail closed with no retry',async t=>{
 const {b,c}=fixture(t);let calls=0;const tts=new TTS(b,{key:()=> 'secret',fetchImpl:async()=>{calls++;throw Error('secret');}});
 assert.equal((await tts.synthesize(c,'hi','a')).status,'uncertain');assert.equal((await tts.synthesize(c,'hi','a')).status,'uncertain');assert.equal(calls,1);assert.ok(!JSON.stringify(b.store.data).includes('secret'));
 const restarted=new TTS(b,{key:()=> 'secret',fetchImpl:()=>{throw Error('must not call');}});b.store.data.ttsJobs[`${c.key}:live:a`].status='pending';assert.equal((await restarted.synthesize(c,'hi','a')).status,'uncertain');
});
test('one source event remains spent across request IDs and restart',async t=>{
 const {b,c}=fixture(t);let calls=0;const make=()=>new TTS(b,{key:()=> 'key',fetchImpl:async()=>{calls++;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});}});
 await make().synthesize(c,'hi','first');b.store.data=JSON.parse(JSON.stringify(b.store.data));
 assert.equal((await make().synthesize(c,'different','second')).status,'already_requested');assert.equal(calls,1);
});
test('overlapping batches remain spent across IDs and restart, including legacy trigger keys',async t=>{
 const {b,c}=fixture(t);let calls=0;const make=()=>new TTS(b,{key:()=> 'key',fetchImpl:async()=>{calls++;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});}});
 b.turns.get(c.key).voiceRequestIds=['1','2'];assert.equal((await make().synthesize(c,'hi','first')).status,'completed');
 b.store.data=JSON.parse(JSON.stringify(b.store.data));
 b.turns.get(c.key).voiceRequestId='2';b.turns.get(c.key).voiceRequestIds=['2','3'];
 assert.equal((await make().synthesize(c,'hi','second')).status,'already_requested');
 b.turns.get(c.key).voiceRequestIds=['9'];b.turns.get(c.key).voiceRequestId='9';b.store.data.ttsTriggers[`${c.key}:live:9`]='legacy';
 assert.equal((await make().synthesize(c,'hi','third')).status,'already_requested');assert.equal(calls,1);
});
test('old request IDs only return receipts for the same source batch',async t=>{
 const {b,c}=fixture(t);let calls=0;const tts=new TTS(b,{key:()=> 'key',fetchImpl:async()=>{calls++;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});}});
 const turn=b.turns.get(c.key);turn.voiceRequestIds=['1','2'];await tts.synthesize(c,'hi','same');
 turn.voiceRequestIds=['2'];turn.voiceRequestId='2';assert.throws(()=>tts.synthesize(c,'hi','same'),/不能跨轮复用/);
 turn.voiceRequestIds=['3'];turn.voiceRequestId='3';assert.throws(()=>tts.synthesize(c,'hi','same'),/不能跨轮复用/);
 assert.equal((await tts.synthesize(c,'hi','new')).status,'completed');assert.equal(calls,2);
});
test('late paid result is suppressed if turn changes or new messages arrive',async t=>{
 for(const invalidate of [
  (b,c)=>b.turns.set(c.key,{qq:false}),
  (b,c)=>{b.turns.get(c.key).silent=true;},
  (b,c)=>{b.turns.get(c.key).deferred={status:'deferred'};},
  (b,c)=>{delete b.turns.get(c.key).voiceRequestId;},
  (b,c)=>b.store.data.inbox.push({chat:c.key,status:'pending'}),
 ]){
  const {b,c}=fixture(t);let release,calls=0;const gate=new Promise(r=>release=r);
  const tts=new TTS(b,{key:()=> 'key',fetchImpl:async()=>{calls++;await gate;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});}});
  const p=tts.synthesize(c,'hi','a');invalidate(b,c);release();const result=await p;
  assert.equal(result.status,'deferred');assert.equal(result.file,undefined);assert.equal(calls,1);assert.equal(b.store.data.ttsJobs[`${c.key}:live:a`].status,'suppressed');
 }
});
test('failed persistence and cancelled bridge cannot call paid API',async t=>{
 const {b,c}=fixture(t);let calls=0;const tts=new TTS(b,{key:()=> 'key',fetchImpl:()=>{calls++;}});
 b.abort.abort();assert.equal((await tts.synthesize(c,'hi','cancel')).status,'deferred');assert.equal(calls,0);
 b.abort=new AbortController();b.store.save=()=>{throw Error('disk full');};
 assert.throws(()=>tts.synthesize(c,'hi','persist'),/disk full/);assert.equal(calls,0);
});
test('queued messages cancel before paid request',async t=>{
 const {b,c}=fixture(t);let calls=0;const tts=new TTS(b,{key:()=> 'key',fetchImpl:()=>{calls++;}});
 for(const status of ['pending','failed','uncertain']){b.store.data.inbox=[{chat:c.key,status}];assert.equal((await tts.synthesize(c,'hi','a')).status,'deferred');}
 assert.equal(calls,0);assert.equal(b.store.data.ttsQuota,undefined);
});
test('manual DSH and silent or deferred turns cannot synthesize',async t=>{
 const {b,c}=fixture(t);let calls=0;const tts=new TTS(b,{key:()=> 'key',fetchImpl:()=>{calls++;}});
 const turn=b.turns.get(c.key);
 for(const patch of [{qq:false},{silent:true},{deferred:{status:'deferred'}},{at:Date.now()-600001}]){
  Object.assign(turn,{qq:true,silent:false,deferred:null,at:Date.now()},patch);
  assert.throws(()=>tts.synthesize(c,'hi','a'));
 }
 assert.equal(calls,0);assert.equal(b.store.data.ttsQuota,undefined);
});
test('daily quota is shared and resets at UTC midnight',async t=>{
 const {b,c}=fixture(t,{ttsDailyLimit:5});let calls=0,now=Date.parse('2026-01-01T23:59:59Z');
 b.turns.get(c.key).at=now;
 const tts=new TTS(b,{now:()=>now,key:()=> 'key',fetchImpl:async()=>{calls++;return new Response('audio',{headers:{'content-type':'audio/mpeg'}});}});
 for(let i=0;i<5;i++){b.turns.get(c.key).voiceRequestId=String(i+1);assert.equal((await tts.synthesize(c,'hi',`req${i}`)).status,'completed');}
 b.turns.get(c.key).voiceRequestId='6';assert.equal((await tts.synthesize(c,'hi','req5')).status,'limited');
 now+=1000;b.turns.get(c.key).at=now;assert.equal((await tts.synthesize(c,'hi','req5')).status,'completed');
 assert.equal(calls,6);assert.equal(b.store.data.ttsQuota['2026-01-01'],5);assert.equal(b.store.data.ttsQuota['2026-01-02'],1);
});
test('expired generated audio is removed without resynthesis',async t=>{
 const {b,c}=fixture(t);let now=0;const tts=new TTS(b,{now:()=>now,key:()=> 'key',fetchImpl:async()=>new Response('data',{headers:{'content-type':'audio/mpeg'}})});
 const first=await tts.synthesize(c,'hi','a');now=86400001;assert.equal((await tts.synthesize(c,'hi','a')).status,'uncertain');assert.equal(fs.existsSync(first.file),false);
});
