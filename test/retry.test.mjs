import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.js';
import { Bridge } from '../lib/bridge.js';
import { defaults } from '../lib/index.js';

function fixture(t,extra={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nia-retry-test-'));
  const store=new Store(path.join(dir,'profile','nia-qq','state.json'));
  const cfg={...defaults,enabled:true,batchMs:0,account:'100',ownerQQ:'200',...extra};
  store.person('100','200','Friend',true);const c=store.chat('100','private','200','Friend');
  let broken=true,ensures=0;const delivered=[];
  const agent={whenIdle:async()=>{},followup:async msg=>{const text=msg.content[0].text;delivered.push(JSON.parse(text.slice(text.indexOf('\n')+1)).messages.map(m=>m.messageId));}};
  const sessions={ensure:async chat=>{ensures++;if(broken&&chat.id==='200')throw Error('startup '+cfg.token);return agent;},flush:async()=>{},wait:async()=>{},close:async()=>{}};
  const bridge=new Bridge({store,api:{},sessions,config:()=>cfg});bridge.account='100';bridge.ready=true;
  const message=(id,user=200,type='private')=>({post_type:'message',self_id:100,message_type:type,user_id:user,group_id:300,message_id:id,time:Math.floor(Date.now()/1000),message:[{type:'text',data:{text:'Message '+id}}]});
  const tick=async()=>{bridge.tick();await Promise.all(bridge.running.values());};
  t.after(async()=>{await bridge.stop();assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('nia-retry-test-'));fs.rmSync(dir,{recursive:true});});
  return {dir,store,c,cfg,bridge,agent,sessions,delivered,message,tick,get ensures(){return ensures;},setBroken:value=>{broken=value;}};
}
test('failed older messages hold newer input during backoff and recover in original order',async t=>{
  const f=fixture(t);f.bridge.event(f.message(1));await f.tick();
  f.setBroken(false);f.bridge.event(f.message(2));await f.tick();
  assert.equal(f.ensures,1);assert.deepEqual(f.delivered,[]);
  f.bridge.failures.get(f.c.key).nextAt=0;await f.tick();await f.tick();
  assert.deepEqual(f.delivered,[['1'],['2']]);
});
test('retries batch a recovered burst together and never turn a later failed backlog into pending',async t=>{
  const f=fixture(t,{batchMs:1,batchMode:'chat'});
  for(let id=1;id<=25;id++)f.bridge.event(f.message(id));
  f.store.data.inbox.forEach(x=>{x.status='failed';x.at=0;});
  await f.tick();assert.equal(f.ensures,1);assert.ok(f.store.data.inbox.every(x=>x.status==='failed'));
  await f.tick();assert.equal(f.ensures,1);
  f.setBroken(false);f.bridge.failures.get(f.c.key).nextAt=0;
  await f.tick();await f.tick();assert.deepEqual(f.delivered.map(x=>x.length),[20,5]);
  assert.deepEqual(f.delivered.flat(),Array.from({length:25},(_,i)=>String(i+1)));
});
test('five failed attempts stop automatic replay; manual retry and ignoring a failed head release the queue',async t=>{
  const f=fixture(t);f.bridge.event(f.message(1));await f.tick();
  for(let n=1;n<5;n++){f.bridge.failures.get(f.c.key).nextAt=0;await f.tick();}
  f.bridge.event(f.message(2));f.bridge.failures.get(f.c.key).nextAt=0;await f.tick();
  assert.equal(f.ensures,5);f.setBroken(false);
  f.store.data.inbox[0].status='pending';await f.tick();await f.tick();
  assert.deepEqual(f.delivered,[['1'],['2']]);
  f.setBroken(true);f.bridge.event(f.message(3));await f.tick();f.bridge.event(f.message(4));
  f.store.data.inbox.find(x=>x.event.message_id==='3').status='discarded';f.setBroken(false);await f.tick();
  assert.deepEqual(f.delivered.at(-1),['4']);
});
test('one failed chat does not block another, and uncertain acceptance is never replayed',async t=>{
  const f=fixture(t);f.bridge.event(f.message(1));await f.tick();
  f.bridge.event(f.message(2));f.bridge.event(f.message(3,201));await f.tick();
  assert.deepEqual(f.delivered,[['3']]);
  f.setBroken(false);f.bridge.failures.get(f.c.key).nextAt=0;
  f.agent.followup=async()=>{throw Error('acceptance unknown');};await f.tick();
  const item=f.store.data.inbox.find(x=>x.event.message_id==='1');assert.equal(item.status,'uncertain');
  f.agent.followup=async()=>{};await f.tick();await f.tick();assert.equal(item.status,'uncertain');
});
test('diagnostics stay beside the configured store and redact the configured token',async t=>{
  const f=fixture(t,{token:'private-test-token'});f.bridge.event(f.message(1));await f.tick();
  const log=fs.readFileSync(path.join(path.dirname(f.store.file),'debug.log'),'utf8');
  assert.match(log,/deliver FAILED/);assert.equal(log.includes(f.cfg.token),false);
  assert.equal(fs.existsSync(path.join(f.dir,'debug.log')),false);
});
