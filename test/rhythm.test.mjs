import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Bridge} from '../lib/bridge.js';
import {Store} from '../lib/store.js';
import {defaults,validateConfig} from '../lib/index.js';
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nia-rhythm-'));
 const store=new Store(path.join(dir,'state.json')), cfg={...defaults,enabled:true,dryRun:false,account:'100',batchMs:1,replyIntervalMs:0};
 const calls=[],prompts=[];let sendHook=()=>{};
 const api={call:async(a,p)=>{if(a==='get_login_info')return {user_id:100};if(a==='get_friend_list')return [{user_id:200}];if(a==='get_group_list')return [{group_id:300},{group_id:301}];calls.push({a,p});await sendHook();return {message_id:900+calls.length};}};
 let bridge;const agent={whenIdle:async()=>{},followup:async p=>{prompts.push(p);bridge.sessionEvent({id:store.data.chats['100:group:300'].sessionId},{type:'user/message',data:{message:p}});}};
 bridge=new Bridge({store,api,config:()=>cfg,sessions:{ensure:async()=>agent,wait:async()=>{},flush:async()=>{},close:async()=>{}}});
 t.after(async()=>{await bridge.stop();assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('nia-rhythm-'));fs.rmSync(dir,{recursive:true});});
 const c=()=>store.data.chats['100:group:300'];
 const add=(id,user=200,text='hello',extra=[],type='group',group=300)=>{bridge.event({post_type:'message',self_id:100,message_type:type,group_id:group,user_id:user,message_id:id,time:Date.now()/1000,message:[{type:'text',data:{text}},...extra]});return store.data.inbox.at(-1);};
 const begin=items=>{const turn=bridge.rhythm.begin(c(),items,'input-'+items[0]?.id);items.forEach(x=>x.status='delivered');return turn;};
 return {bridge,cfg,store,calls,prompts,agent,c,add,begin,setSendHook:f=>sendHook=f};
}
test('adaptive batches combine group speakers, retain private sender mode, and allow opt-out',async t=>{
 const f=setup(t);await f.bridge.connect();f.add(1);f.add(2,201);
 assert.equal(f.bridge.batch(f.bridge.pendingMessages(f.c())).length,2);
 f.cfg.batchMode='sender';assert.equal(f.bridge.batch(f.bridge.pendingMessages(f.c())).length,1);
 f.cfg.batchMode='adaptive';f.cfg.batchMs=0;assert.equal(f.bridge.batch(f.bridge.pendingMessages(f.c())).length,1);
 assert.throws(()=>validateConfig({maxReplyYields:6}));assert.throws(()=>validateConfig({interruptPolicy:'semantic-magic'}));
});
test('unrelated group chatter does not block a reply and stays pending unread',async t=>{
 const f=setup(t);await f.bridge.connect();f.begin([f.add(1)]);const other=f.add(2,201,'lunch?');
 assert.equal((await f.bridge.say(f.c(),'answer','a')).status,'confirmed');assert.equal(other.status,'pending');
 assert.equal(f.calls.length,1);assert.equal(f.prompts.length,0);
});
test('focus sender followup, explicit mention and a reply reference each yield before sending',async t=>{
 const f=setup(t);await f.bridge.connect();
 for(const kind of ['sender','mention','reference']){
   f.store.data.inbox.forEach(x=>x.status='delivered');f.bridge.rhythm.yields.clear();
   const first=f.add(10+f.calls.length+f.store.data.inbox.length);f.begin([first]);
   const extra=kind==='mention'?[{type:'at',data:{qq:'100'}}]:kind==='reference'?[{type:'reply',data:{id:first.event.message_id}}]:[];
   f.add(100+f.store.data.inbox.length,kind==='sender'?200:201,'补充',extra);
   assert.equal((await f.bridge.say(f.c(),'old','reply-'+kind)).status,'deferred');
 }
 assert.equal(f.calls.length,0);
});
test('same person addressing somebody else is background, not an interruption',async t=>{
 const f=setup(t);await f.bridge.connect();f.begin([f.add(1)]);
 f.add(2,200,'你吃饭了吗',[{type:'at',data:{qq:'201'}}]);
 assert.equal((await f.bridge.say(f.c(),'answer','other-address')).status,'confirmed');
});
test('model can select already-read target messages without claiming unseen messages',async t=>{
 const f=setup(t);await f.bridge.connect();const a=f.add(1),b=f.add(2,201);const turn=f.begin([a,b]);
 assert.deepEqual(turn.focusUsers,['201']);f.add(3,200,'补充');
 await assert.rejects(()=>f.bridge.say(f.c(),'bad','bad',{focusMessageIds:['3']}),/本轮已经读到/);
 await assert.rejects(()=>f.bridge.say(f.c(),'bad','empty',{focusMessageIds:[]}),/本轮已经读到/);
 assert.equal((await f.bridge.say(f.c(),'answer A','focus-a',{focusMessageIds:['1']})).status,'deferred');
});
test('delayed QQ user/message event retains the admitted batch and allows its focus ID',async t=>{
 const f=setup(t);await f.bridge.connect();f.cfg.batchMs=0;
 let delivered;f.agent.followup=async p=>{delivered=p;};
 f.add(42);f.bridge.tick();await Promise.all(f.bridge.running.values());
 const turn=f.bridge.turns.get(f.c().key);assert.deepEqual(turn.messages.map(x=>x.id),['42']);
 f.bridge.sessionEvent({id:f.c().sessionId},{type:'user/message',data:delivered});
 assert.equal(f.bridge.turns.get(f.c().key),turn);
 assert.equal((await f.bridge.say(f.c(),'answer','delayed',{focusMessageIds:['42']})).status,'confirmed');
});
test('desktop user turn does not adopt old QQ focus identifiers',async t=>{
 const f=setup(t);await f.bridge.connect();f.begin([f.add(1)]);
 f.bridge.sessionEvent({id:f.c().sessionId},{type:'user/message',data:{source:{kind:'user'}}});
 await assert.rejects(()=>f.bridge.say(f.c(),'old','desktop',{focusMessageIds:['1']}),/DSH 会话输入/);
 assert.equal(f.calls.length,0);
});
test('ordinary group interruptions yield only twice, duplicate sends in the same turn do not spend another yield',async t=>{
 const f=setup(t);await f.bridge.connect();let first=f.add(1);f.begin([first]);
 for(let i=0;i<3;i++){
   const next=f.add(i+2);const r=await f.bridge.say(f.c(),'reply','round-'+i);
   assert.equal(r.status,i<2?'deferred':'confirmed');
   if(i<2){assert.equal((await f.bridge.say(f.c(),'retry new id','extra-'+i)).status,'deferred');assert.equal(f.bridge.rhythm.yields.get(f.c().key),i+1);f.begin([next]);}
 }
 assert.equal(f.calls.length,1);assert.equal(f.bridge.pendingMessages(f.c()).length,1);
});
test('explicit correction or stop still wins after the ordinary yield allowance is exhausted',async t=>{
 const f=setup(t);await f.bridge.connect();f.begin([f.add(1)]);f.bridge.rhythm.yields.set(f.c().key,2);
 f.add(2,200,'等我说完，我说错了，先别发');
 const r=await f.bridge.say(f.c(),'stale','correction');assert.equal(r.reason,'correction');assert.equal(r.status,'deferred');assert.equal(f.calls.length,0);
});
test('private supplements always pause, even with group yield allowance set to zero',async t=>{
 const f=setup(t);await f.bridge.connect();f.cfg.maxReplyYields=0;
 const c=f.store.data.chats['100:private:200'];f.add(1,200,'hello',[],'private');const item=f.store.data.inbox.at(-1);f.bridge.rhythm.begin(c,[item]);item.status='delivered';f.add(2,200,'补充',[],'private');
 assert.equal((await f.bridge.say(c,'old','private')).status,'deferred');
});
test('DSH input event retains admitted focus and background during assessment does not restart the batch',async t=>{
 const f=setup(t);await f.bridge.connect();const a=f.add(1);a.at-=100;
 f.cfg.cooperate=true;
 f.bridge.cooperation.incoming=async()=>{f.add(2,201,'background');return [];};
 await f.bridge.deliver(f.c(),[a]);
 assert.equal(f.prompts.length,1);assert.deepEqual(f.bridge.turns.get(f.c().key).focusUsers,['200']);assert.equal(a.status,'delivered');
 f.cfg.cooperate=false;assert.equal((await f.bridge.say(f.c(),'answer','after-judge')).status,'confirmed');
});
test('split-send ignores background but stops remaining parts for a relevant correction',async t=>{
 const f=setup(t);await f.bridge.connect();f.begin([f.add(1)]);
 f.setSendHook(async()=>{if(f.calls.length===1)f.add(2,201,'chatting');if(f.calls.length===2)f.add(3,200,'先别发');});
 const r=await f.bridge.say(f.c(),'first\n\nsecond\n\nthird','split');assert.equal(r.status,'deferred');assert.equal(r.partsSent,2);assert.equal(f.calls.length,2);
});
test('queued old-turn sends are cancelled when a new turn starts, and another group cannot block this one',async t=>{
 const f=setup(t);await f.bridge.connect();f.begin([f.add(1)]);f.add(2,200,'other group',[],'group',301);
 assert.equal((await f.bridge.say(f.c(),'reply','cross')).status,'confirmed');
 let release;const wait=new Promise(r=>release=r);f.bridge.outbox.chains.set(f.c().key,wait);
 const stale=f.bridge.say(f.c(),'old queued','stale');f.begin([f.add(3)]);release();
 assert.equal((await stale).status,'deferred');assert.equal(f.calls.length,1);
});
test('parallel send requests retain their own focus while waiting for the chat send queue',async t=>{
 const f=setup(t);await f.bridge.connect();const a=f.add(1),b=f.add(2,201);f.begin([a,b]);f.add(3,201,'补充 B');
 let release;f.bridge.outbox.chains.set(f.c().key,new Promise(r=>release=r));
 const replyA=f.bridge.say(f.c(),'answer A','parallel-a',{focusMessageIds:['1']});
 const replyB=f.bridge.say(f.c(),'answer B','parallel-b',{focusMessageIds:['2']});release();
 assert.equal((await replyA).status,'confirmed');assert.equal((await replyB).status,'deferred');assert.equal(f.calls.length,1);
});
