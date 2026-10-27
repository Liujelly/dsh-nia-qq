import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Media,segments,cardText,splitMessage,extractImages,runCommand} from '../lib/media.js';
import {Bridge} from '../lib/bridge.js';
import {Store} from '../lib/store.js';
import {defaults,validateConfig} from '../lib/index.js';
const png=Buffer.from('89504e470d0a1a0a0000000049454e44','hex');
const event=(id=1,user=200,type='private',message=[{type:'text',data:{text:'hello'}}])=>({post_type:'message',self_id:100,message_type:type,user_id:user,group_id:300,message_id:id,time:Math.floor(Date.now()/1000),sender:{nickname:'Person '+user},message});
function setup(t,opts={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nia-restored-'));const store=new Store(path.join(dir,'state.json'));
  const cfg={...defaults,enabled:true,account:'100',ownerQQ:'200',batchMs:0,batchMode:'sender',replyIntervalMs:0,...opts};
  const calls=[],prompts=[],reports=[];let handler=async()=>({message_id:1000+calls.length});
  const api={call:async(action,params)=>{calls.push({action,params});return ({get_login_info:{user_id:100},get_friend_list:[{user_id:200,nickname:'Friend'}],get_group_list:[{group_id:300,group_name:'Group'}]})[action]??handler(action,params);}};
  const media=new Media({directory:path.join(dir,'media'),api,config:()=>cfg,fetchBytes:async()=>png});
  const agent={whenIdle:async()=>{},followup:async p=>prompts.push(p)};
  const sessions={ensure:async()=>agent,flush:async()=>{},close:async()=>{},wait:async()=>{}};
  const bridge=new Bridge({store,api,sessions,media,config:()=>cfg,report:m=>reports.push(m)});
  t.after(async()=>{await bridge.stop();assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('nia-restored-'));fs.rmSync(dir,{recursive:true});});
  return {dir,store,cfg,calls,prompts,media,bridge,agent,reports,setHandler:f=>handler=f,c:()=>store.data.chats['100:private:200'],g:()=>store.data.chats['100:group:300']};
}
test('group prompts distinguish mentioning the bot, another member, everyone and replies',async t=>{
  const f=setup(t,{batchMs:0});await f.bridge.connect();
  f.store.person('100','201','Other');
  const cases=[['201','other',false],['100','self',true],['all','all',false]];
  for(const [i,[target,type,atSelf]] of cases.entries()){
    f.bridge.event(event(i+1,200,'group',[{type:'at',data:{qq:target}},{type:'text',data:{text:'test'}}]));
    f.bridge.tick();await Promise.all(f.bridge.running.values());
    const prompt=f.prompts.at(-1).content.find(x=>x.type==='text').text;
    const payload=JSON.parse(prompt.slice(prompt.indexOf('\n')+1));
    assert.equal(payload.messages[0].atSelf,atSelf);
    assert.equal(payload.messages[0].mentions[0].type,type);
    assert.equal(payload.messages[0].replyToSelf,false);
    if(type==='other')assert.equal(payload.messages[0].mentions[0].platformName,'Other');
  }
});
test('sender batching never merges across an intervening speaker; zero disables and chat mode opts in',async t=>{
  const f=setup(t,{batchMs:3000});await f.bridge.connect();
  for(const [id,user]of [[1,200],[2,200],[3,201],[4,200]])f.bridge.event(event(id,user,'group'));
  const items=f.bridge.pendingMessages(f.g());items.forEach(x=>x.at-=4000);
  assert.deepEqual(f.bridge.batch(items).map(x=>x.event.message_id),['1','2']);
  // The wire IDs can be numeric or strings; compare normalized IDs.
});
test('sender/chat/disabled modes preserve order and eventually deliver all queued speakers',async t=>{
  const f=setup(t,{batchMs:1});await f.bridge.connect();
  for(const [id,user]of [[1,200],[2,200],[3,201],[4,200]])f.bridge.event(event(id,user,'group'));
  const items=f.bridge.pendingMessages(f.g());items.forEach(x=>x.at-=4000);
  assert.equal(f.bridge.batch(items).length,2);f.cfg.batchMode='chat';assert.equal(f.bridge.batch(items).length,4);
  f.cfg.batchMs=0;assert.equal(f.bridge.batch(items).length,1);f.cfg.batchMs=1;f.cfg.batchMode='sender';
  for(let n=0;n<3;n++){f.bridge.tick();await Promise.all(f.bridge.running.values());}
  assert.equal(f.prompts.length,3);assert.equal(f.store.data.inbox.filter(x=>x.status==='pending').length,0);
});
test('paragraphs keep single newlines, markdown images are extracted without leaking markup',()=>{
  assert.deepEqual(splitMessage('a\nb\n\nc'),['a\nb','c']);assert.deepEqual(splitMessage('a\n\nb',false),['a\n\nb']);
  assert.deepEqual(extractImages('hello ![a](<a b.gif>)\n![b](https://x.example/p.png)'),{text:'hello \n',images:['a b.gif','https://x.example/p.png']});
  assert.equal(segments('hello [CQ:at,qq=100] &#91;x&#93;')[1].type,'at');
});
test('split sends serialize, keep durable per-part receipts and repeat without double send',async t=>{
  const f=setup(t,{dryRun:false});await f.bridge.connect();
  await Promise.all([f.bridge.say(f.c(),'one\n\ntwo','reply-1'),f.bridge.say(f.c(),'three','reply-2')]);
  const sent=f.calls.filter(x=>x.action==='send_private_msg');assert.deepEqual(sent.map(x=>x.params.message[0].data.text),['one','two','three']);
  const again=await f.bridge.say(f.c(),'one\n\ntwo','reply-1');assert.equal(again.repeated,true);assert.equal(f.calls.filter(x=>x.action==='send_private_msg').length,3);
  assert.equal(Object.values(new Store(f.store.file).data.outbox)[0].status,'completed');
  await assert.rejects(()=>f.bridge.say(f.c(),'changed','reply-1'),/不同操作/);
});
test('new input during split send cancels the remaining parts permanently',async t=>{
  const f=setup(t,{dryRun:false});await f.bridge.connect();let sent=0;
  f.setHandler(async a=>{if(a==='send_private_msg'&&++sent===1)f.bridge.event(event(9));return {message_id:900};});
  const result=await f.bridge.say(f.c(),'first\n\nsecond','split');assert.equal(result.status,'deferred');assert.equal(sent,1);
  f.store.data.inbox[0].status='delivered';assert.equal((await f.bridge.say(f.c(),'first\n\nsecond','split')).status,'deferred');assert.equal(sent,1);
});
test('unknown first-part result blocks later parts and restart retries',async t=>{
  const f=setup(t,{dryRun:false});await f.bridge.connect();f.setHandler(async()=>{throw Error('connection lost');});
  await assert.rejects(()=>f.bridge.say(f.c(),'a\n\nb','uncertain'));
  assert.equal((await f.bridge.say(f.c(),'a\n\nb','uncertain')).status,'uncertain');assert.equal(f.calls.filter(x=>x.action==='send_private_msg').length,1);
});
test('preview split and media keep receipts without external sends; disabled images fail before any text',async t=>{
  const f=setup(t);await f.bridge.connect();const image=f.media.save(png,'png');
  assert.equal((await f.bridge.sendMedia(f.c(),{text:'hi',images:[image],requestId:'preview'})).status,'preview');
  assert.equal(f.calls.filter(x=>x.action.startsWith('send_')).length,0);
  assert.ok(!JSON.stringify(f.store.data.actions).includes(png.toString('base64')));
  f.cfg.sendImages=false;await assert.rejects(()=>f.bridge.say(f.c(),`hi\n\n![x](${image})`,'off'),/发图/);
});
test('media decode expands cards, forward nesting and quoted text; shared image limit applies',async t=>{
  const f=setup(t,{imageLimit:1});await f.bridge.connect();
  f.setHandler(async(a,p)=>a==='get_msg'?{sender:{nickname:'quoted'},message:[{type:'text',data:{text:'original text'}}]}:a==='get_forward_msg'?{messages:[{sender:{nickname:'Nested'},content:[{type:'image',data:{file:'base64://'+png.toString('base64')}},{type:'forward',data:{id:p.id==='a'?'b':'a'}}]}]}:{});
  const d=await f.media.decode([{type:'reply',data:{id:'88'}},{type:'forward',data:{id:'a'}},{type:'image',data:{file:'base64://'+png.toString('base64')}}]);
  assert.match(d.text,/original text/);assert.match(d.text,/Nested/);assert.equal(d.images.length,1);assert.equal(f.calls.filter(x=>x.action==='get_forward_msg').length,2);
  const card=cardText(JSON.stringify({meta:{detail_1:{title:'title',qqdocurl:'https://bilibili.com/video/BV1234567890'}}}),'json');assert.match(card,/title/);assert.match(card,/BV1234567890/);
  assert.match(cardText('<msg url="https://example.com"><title><![CDATA[分享]]></title></msg>','xml'),/分享/);
});
test('incoming image is admitted to DSH and original GIF is preserved for outgoing',async t=>{
  const f=setup(t);await f.bridge.connect();const gif=Buffer.from('GIF89a0000000000');let admitted;
  f.media.attachments={admitPromptContent:async content=>{admitted=content;return [content[0],{type:'image',attachment:{attachmentId:'a1'}}];},imageHostPath:()=>'/converted.webp'};
  f.bridge.event(event(3,200,'private',[{type:'image',data:{file:'base64://'+gif.toString('base64')}}]));
  f.bridge.tick();await Promise.all(f.bridge.running.values());
  assert.equal(admitted[1].mediaType,'image/gif');assert.equal(f.prompts[0].content[1].type,'image');
  const out=await f.media.outbound('a1',f.dir);assert.equal(out.data.file,'base64://'+gif.toString('base64'));
  const resumed=new Media({directory:f.media.directory,api:f.media.api,config:()=>f.cfg});assert.equal((await resumed.outbound('a1',f.dir)).data.file,out.data.file);resumed.stop();
  assert.equal(f.store.data.inbox[0].event.segments,undefined);
});
test('image download cap applies across a combined batch, not separately to every message',async t=>{
  const f=setup(t,{batchMs:1,imageLimit:1});await f.bridge.connect();
  for(const id of [1,2])f.bridge.event(event(id,200,'private',[{type:'image',data:{file:'base64://'+png.toString('base64')}}]));
  f.store.data.inbox.forEach(x=>x.at-=3000);f.bridge.tick();await Promise.all(f.bridge.running.values());
  assert.equal(f.store.data.inbox.reduce((n,x)=>n+x.event.images.length,0),1);
});
test('ASR requests WAV and passes a generated local path as one argument, never a shell command',async t=>{
  const f=setup(t,{asrEnabled:true,asrExecutable:'python',asrArgs:'["script.py","{file}"]'});await f.bridge.connect();let run;
  f.setHandler(async a=>a==='get_record'?{base64:Buffer.from('RIFFtestWAVE').toString('base64')}:{});
  f.media.run=async(exe,args)=>{run={exe,args};return '你好';};
  assert.match(await f.media.voice({file:'voice-id'}),/你好/);assert.equal(run.exe,'python');assert.equal(run.args[0],'script.py');assert.ok(fs.existsSync(run.args[1]));
  f.media.run=async()=>{throw Error('private backend failure');};assert.equal((await f.media.voice({file:'voice-id'})).includes('private'),false);
});
test('command runner bounds execution and safely passes shell metacharacters as literal arguments',async()=>{
  const text=await runCommand(process.execPath,['-e','process.stdout.write(process.argv[1])','$(literal)&value']);assert.equal(text,'$(literal)&value');
  await assert.rejects(()=>runCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:30}),/超时/);
});
test('group directed reception admits configured user, mentions and own-message replies only',async t=>{
  const f=setup(t,{groupScope:'directed',dryRun:false});await f.bridge.connect();
  await f.bridge.say(f.g(),'test','own');const own=f.calls.filter(x=>x.action==='send_group_msg').length;assert.equal(own,1);
  const id=Object.values(f.store.data.actions)[0].result.message_id;
  f.bridge.event(event(1,201,'group'));f.bridge.event(event(2,200,'group'));
  f.bridge.event(event(3,201,'group',[{type:'at',data:{qq:'100'}}]));
  f.bridge.event(event(4,201,'group',[{type:'reply',data:{id:String(id)}}]));
  assert.deepEqual(f.store.data.inbox.map(x=>x.event.message_id),['2','3','4']);
  f.bridge.tick();await Promise.all(f.bridge.running.values());
  f.store.data.inbox.forEach(x=>x.status='delivered');assert.equal(f.bridge.gate(f.g(),false).applied,true);
  assert.equal((await f.bridge.say(f.g(),'do not send','blocked')).status,'suppressed');
  f.bridge.turns.get(f.g().key).at=0;assert.equal(f.bridge.gate(f.g(),true).applied,false);
});
test('history starts at activation, reconnect backfills once and failed lookups retain checkpoint',async t=>{
  const f=setup(t);await f.bridge.connect();assert.equal(f.calls.filter(x=>x.action.endsWith('_msg_history')).length,0);
  f.store.data.history[f.c().key]=Date.now()-5000;
  const m=event(91);f.setHandler(async a=>a.endsWith('_msg_history')?{messages:[m]}:{});
  await f.bridge.recover();await f.bridge.recover();assert.equal(f.store.data.inbox.length,1);
  const checkpoint=f.store.data.history[f.c().key];f.setHandler(async()=>{throw Error('unsupported');});await f.bridge.recover();assert.equal(f.store.data.history[f.c().key],checkpoint);assert.match(f.reports.at(-1),/补收失败/);
});
test('history skips self, expired messages and stays isolated by chat',async t=>{
  const f=setup(t,{historyMinutes:1});await f.bridge.connect();f.store.data.history[f.c().key]=Date.now()-120000;
  f.setHandler(async a=>({messages:a==='get_friend_msg_history'?[{...event(8),time:Math.floor(Date.now()/1000)-90},event(9,100),event(10)]:[]}));
  await f.bridge.recover();assert.deepEqual(f.store.data.inbox.map(x=>x.event.message_id),['10']);assert.equal(f.store.data.inbox[0].chat,f.c().key);
});

test('temporary peers skip friend history but retain real-time messages; adding a friend restores backfill',async t=>{
  const f=setup(t);await f.bridge.connect();
  f.bridge.event({...event(93,999),sub_type:'group'});
  const temporary=f.store.data.chats['100:private:999'];
  f.store.data.history[temporary.key]=Date.now()-5000;const before=f.store.data.history[temporary.key];
  f.setHandler(async(_action,params)=>{if(params.user_id===999)throw Error('failed to resolve UID');return {messages:[]};});
  await f.bridge.recover();assert.equal(f.calls.some(x=>x.action==='get_friend_msg_history'&&x.params.user_id===999),false);
  assert.equal(f.store.data.history[temporary.key],before);assert.equal(f.reports.at(-1),'');
  f.bridge.tick();await Promise.all(f.bridge.running.values());assert.equal(f.prompts.length,1);
  f.store.person('100','999','Temporary',true);f.setHandler(async()=>({messages:[]}));
  await f.bridge.recover();assert.equal(f.calls.some(x=>x.action==='get_friend_msg_history'&&x.params.user_id===999),true);
  assert.ok(f.store.data.history[temporary.key]>=before);
});

test('history errors identify the failed chat and clear after success without advancing failed checkpoints',async t=>{
  const f=setup(t);await f.bridge.connect();const before=f.store.data.history[f.c().key];
  f.setHandler(async(action)=>{if(action==='get_friend_msg_history')throw Error('backend secret');return {messages:[]};});
  await f.bridge.recover();assert.match(f.reports.at(-1),/私聊 Friend/);assert.equal(f.reports.at(-1).includes('secret'),false);
  assert.equal(f.store.data.history[f.c().key],before);
  f.setHandler(async()=>({messages:[]}));await f.bridge.recover();assert.equal(f.reports.at(-1),'');
});
test('auto forwarding accepts completed final message, obeys markers/wake, avoids tool-send duplicate',async t=>{
  const f=setup(t,{autoForward:true,onlyMarked:true,dryRun:false});await f.bridge.connect();
  const session={id:f.c().sessionId,header:{cwd:f.dir}};
  const user=()=>f.bridge.sessionEvent(session,{type:'user/message',data:{message:{source:{kind:'qq'}}}});
  const reply=n=>{f.bridge.sessionEvent(session,{type:'assistant/message',data:{turn:n,message:{content:[{type:'text',text:'local [QQ]hi[/QQ] local'}]}}});f.bridge.sessionEvent(session,{type:'turn/end',data:{turn:n,reason:{kind:'completed'}}});};
  user();reply(1);await f.bridge.outbox.close();assert.equal(f.calls.filter(x=>x.action==='send_private_msg').length,1);assert.equal(f.calls.at(-1).params.message[0].data.text,'hi');
  user();await f.bridge.say(f.c(),'tool','tool');reply(2);await f.bridge.outbox.close();assert.equal(f.calls.filter(x=>x.action==='send_private_msg').length,2);
  f.bridge.sessionEvent(session,{type:'user/message',data:{message:{source:{kind:'user'}}}});reply(3);await f.bridge.outbox.close();assert.equal(f.calls.filter(x=>x.action==='send_private_msg').length,2);
});
test('restored settings validate numeric fields and ASR arguments',()=>{
  assert.equal(validateConfig({batchMs:0}).batchMs,0);assert.equal(validateConfig({maxBatchMs:20000}).maxBatchMs,20000);
  for(const cfg of [{replyIntervalMs:6000},{imageLimit:11},{batchMode:'bad'},{asrArgs:'{}'},{asrEnabled:true},{maxBatchMs:'12000'}])assert.throws(()=>validateConfig(cfg));
  assert.equal(validateConfig({asrEnabled:true,asrExecutable:'python',asrArgs:'["{file}"]'}).asrEnabled,true);
});
