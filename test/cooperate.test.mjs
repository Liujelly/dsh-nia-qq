import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.js';
import { Bridge } from '../lib/bridge.js';
import { Sessions } from '../lib/sessions.js';
import { defaults } from '../lib/index.js';
import { Database } from '../../dsh-nia-memory/lib/store.js';
import { Memory } from '../../dsh-nia-memory/lib/core.js';
import { attachMemory } from '../../dsh-nia-memory/lib/index.js';
import { LinkedMood } from '../../dsh-nia-mood/lib/linked.js';
const delta = (moodDelta = 0, dims = {}, reason = '正常变化') => ({ moodDelta, dims, reason, confidence: 90 });
async function setup(t, preview = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-joint-test-'));
  const db = new Database(path.join(dir, 'memory')), memory = new Memory(db), offs = [], mounted = new WeakSet();
  memory.attach = (a, b) => { memory.bind(b); if (!mounted.has(a)) { attachMemory(memory, a, b, offs); mounted.add(a); } };
  const evaluations = [], mood = new LinkedMood(async (_agent, input) => {
    evaluations.push(input); const e = input.events[0], insult = e.text.includes('讨厌');
    return { overall: delta(insult ? -6 : 3, insult ? { anger: 8 } : { calm: 4 }, insult ? '被群友冒犯' : '收到安慰'),
      targets: [{ actorId: e.actorId, ...delta(insult ? -6 : 3, insult ? { anger: 8 } : { sweet: 4 }, insult ? '对群友不满' : '愿意亲近安慰者') }] };
  });
  const live = new Map(), saved = new Map(), prompts = [], calls = [], reports = [];
  const cfg = { ...defaults, cooperate: true, enabled: true, dryRun: preview, account: '100', ownerQQ: '200', batchMs: 0, provider: 'p', model: 'm', workspace: dir };
  const host = { niaMemory: memory, niaMood: mood, get(n) { return this[n]; },
    agents: { get: id => live.get(id), list: () => [...live.values()], create: opt => open(opt), resume: opt => open(opt) },
    sessionPersistence: { stat: async id => saved.get(id), flush: async () => {} } };
  const open = async opt => {
    const id = opt.sessionId || opt.resumeSessionId, tools = new Map(), contexts = new Map(), sections = new Map();
    const reg = map => entry => { map.set(entry.name, entry); return () => map.delete(entry.name); };
    const a = { session: { id, header: {}, snapshotEvents: () => [], append: () => {} }, tools, contexts, sections,
      ctx: { tools: { register: reg(tools) }, systemPrompt: { context: reg(contexts), section: reg(sections) } },
      whenIdle: async () => {}, followup: async p => { prompts.push({ sid: id, p, agent: a }); if (p.source.kind === 'nia-contact' && cfg.replyToContact) await tools.get('nia_qq_say').execute({ text: '你现在有空吗', requestId: 'contact-' + p.id.slice(-30) }); } };
    await opt.setup(a.ctx, a); live.set(id, a); saved.set(id, {}); return { agent: a, dispose: async () => live.delete(id) };
  };
  const store = new Store(path.join(dir, 'qq.json')), sessions = new Sessions(host, store, () => cfg);
  const api = { call: async (action, params) => { calls.push({ action, params }); return ({ get_login_info: { user_id: 100 }, get_friend_list: [{ user_id: 200, nickname: '用户' }], get_group_list: [{ group_id: 300, group_name: '群' }] })[action] || { message_id: 123 }; } };
  const bridge = new Bridge({ store, sessions, config: () => cfg, api, report: s => reports.push(s) }); await bridge.connect();
  const drain = async () => { bridge.tick(); await Promise.all(bridge.running.values()); };
  const message = (id, group = true, text = '妮娅你真讨厌') => bridge.event({ post_type: 'message', self_id: 100, message_type: group ? 'group' : 'private', group_id: 300, user_id: group ? 201 : 200, message_id: id, time: 1, sender: { nickname: '同名' }, message: text });
  t.after(async () => { await bridge.stop(); mood.close(); for (const off of offs.reverse()) off?.(); db.close(); if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith('nia-joint-test-')) throw new Error('cleanup'); fs.rmSync(dir, { recursive: true }); });
  return { db, memory, mood, cfg, host, store, bridge, drain, message, evaluations, prompts, calls, reports, sessions };
}
test('role display names follow configuration while the existing QQ session and emotional history are inherited',async t=>{
  const f=await setup(t);f.cfg.characterName='星澄';f.message(1);await f.drain();
  const c=f.store.data.chats['100:group:300'],sid=c.sessionId,oldVersion=f.memory.mood(sid).version;
  assert.equal(f.memory.binding(sid).characterName,'星澄');assert.equal(f.evaluations[0].binding.characterName,'星澄');
  const retained=Object.keys(f.db.data.events);
  f.cfg.characterName='沈舟';f.message(2,true,'新发现很有趣');await f.drain();
  assert.equal(c.sessionId,sid);assert.equal(f.memory.binding(sid).characterName,'沈舟');
  assert.equal(f.evaluations.at(-1).binding.characterName,'沈舟');assert.equal(f.memory.moodKey(sid),'nia:live');
  assert.equal(f.memory.mood(sid).version,oldVersion+1);for(const key of retained)assert.ok(f.db.data.events[key]);
  const sections=[...f.host.agents.get(sid).sections.values()].map(x=>x.text).join('\n');assert.doesNotMatch(sections,/妮娅/);
});

test('group insult → optional private contact → comfort: shared state, separate targets and exactly one evaluation per event', async t => {
  const f = await setup(t); f.cfg.replyToContact = true; f.message(1); await f.drain();
  const group = f.store.data.chats['100:group:300'], privateChat = f.store.data.chats['100:private:200'];
  const eventId = Object.values(f.db.data.events)[0].id;
  const groupAgent = f.host.agents.get(group.sessionId);
  const request = { actorId: 'qq:100:200', reason: '想和熟悉的人说说刚才的事', evidenceIds: [eventId], requestId: 'intent1' };
  const contact = await groupAgent.tools.get('nia_qq_contact').execute(request); assert.equal(contact.status, 'pending');
  await f.drain(); assert.equal(f.store.data.intents[contact.id].status, 'handled');
  assert.equal(f.evaluations.length, 1); assert.equal(f.calls.filter(c => c.action === 'send_private_msg').length, 1);
  assert.ok(Object.values(f.db.data.events).find(e => e.type === 'outbound'));
  const privateAgent = f.host.agents.get(privateChat.sessionId), text = privateAgent.contexts.get('nia-linked-mood').text();
  assert.match(text, /towardCurrentPeople/); assert.doesNotMatch(text, /qq:100:201/);
  const before = f.memory.mood(group.sessionId); assert.equal(before.targets['qq:100:200'], undefined);
  f.message(2, false, '我在呢，刚才那人说话确实难听'); await f.drain();
  const after = f.memory.mood(privateChat.sessionId);
  assert.equal(after.targets['qq:100:201'].dims.anger, before.targets['qq:100:201'].dims.anger);
  assert.equal(after.targets['qq:100:200'].dims.sweet, 4); assert.ok(after.overall.mood > before.overall.mood);
  await f.mood.assess(f.memory, groupAgent, group.sessionId, [eventId]); assert.equal(f.evaluations.length, 2);
  const duplicate = await groupAgent.tools.get('nia_qq_contact').execute({ ...request, requestId: 'different-id' }); assert.equal(duplicate.repeated, true);
  await f.drain(); assert.equal(f.calls.filter(c => c.action === 'send_private_msg').length, 1);
  const restored = new Store(f.store.file); assert.equal(restored.data.intents[contact.id].status, 'handled');
});
test('preview uses separate DSH histories, survives reload, and does not send', async t => {
  const f = await setup(t, true); f.cfg.replyToContact = true; f.message(1); await f.drain();
  const group = f.store.data.chats['100:group:300']; assert.ok(group.previewCreated); assert.equal(group.created, false);
  assert.ok(f.host.agents.get(group.previewSessionId)); assert.equal(f.host.agents.get(group.sessionId), undefined);
  const evidenceId = Object.values(f.db.data.events)[0].id;
  f.bridge.cooperation.contact(group, { actorId: 'qq:100:200', reason: '预演联系', evidenceIds: [evidenceId], requestId: 'preview' }); await f.drain();
  assert.equal(f.calls.filter(c => c.action === 'send_private_msg').length, 0);
  assert.ok(Object.values(f.db.data.actions).some(x => x.status === 'preview'));
  f.cfg.dryRun = false; f.message(2); await f.drain(); assert.ok(f.host.agents.get(group.sessionId));
  const a = f.host.agents.get(group.sessionId); assert.doesNotMatch(a.contexts.get('nia-memory:context').text(), new RegExp(evidenceId));
  const restored = new Store(f.store.file); assert.equal(restored.data.chats[group.key].previewSessionId, group.previewSessionId);
});
test('private sources, paused chats, self-contact, unknown targets and recursive contacts are rejected', async t => {
  const f = await setup(t, true); f.message(1); await f.drain();
  const group = f.store.data.chats['100:group:300'], target = f.store.data.chats['100:private:200'];
  const evidenceId = Object.values(f.db.data.events)[0].id;
  const args = { actorId: 'qq:100:200', reason: '想聊', evidenceIds: [evidenceId], requestId: 'one' };
  const route = f.bridge.cooperation.route(group); group.paused = true; assert.equal(route.paused, true);
  assert.throws(() => f.bridge.cooperation.contact(route, args)); group.paused = false;
  target.paused = true; assert.throws(() => f.bridge.cooperation.contact(group, args)); target.paused = false;
  assert.throws(() => f.bridge.cooperation.contact(group, { ...args, actorId: 'qq:100:999' }));
  f.bridge.cooperation.waking.add(group.key); assert.throws(() => f.bridge.cooperation.contact(group, args)); f.bridge.cooperation.waking.clear();
  const m = f.memory.remember(group.previewSessionId, { text: '不外传的事情', subjects: ['qq:100:201'], evidenceIds: [evidenceId], kind: 'event', status: 'reported' });
  f.memory.edit(m.id, 'private'); assert.throws(() => f.bridge.cooperation.contact(group, args), /原聊天/);
});
test('missing service fails before followup; disabling memory blocks sending and queued contact', async t => {
  const f = await setup(t); delete f.host.niaMood; f.message(1); await f.drain();
  assert.equal(f.prompts.length, 0); assert.equal(f.store.data.inbox[0].status, 'failed');
  f.host.niaMood = f.mood; f.store.data.inbox[0].status = 'pending'; await f.drain();
  const group = f.store.data.chats['100:group:300']; f.db.transaction(d => { d.enabled = false; });
  await assert.rejects(f.bridge.say(group, 'hi', 'disabled')); assert.equal(f.calls.filter(c => c.action === 'send_group_msg').length, 0);
});
test('memory receipt failure cannot turn confirmed sends into retries; same request repairs receipt', async t => {
  const f = await setup(t); f.message(1); await f.drain(); const c = f.store.data.chats['100:group:300'];
  const original = f.memory.outbound.bind(f.memory); f.memory.outbound = () => { throw new Error('disk full'); };
  const result = await f.bridge.say(c, '测试', 'repair'); assert.equal(result.status, 'confirmed'); assert.equal(result.memorySynced, false);
  f.memory.outbound = original; await f.bridge.say(c, '测试', 'repair');
  assert.equal(f.calls.filter(c => c.action === 'send_group_msg').length, 1); assert.ok(Object.values(f.db.data.events).some(e => e.type === 'outbound'));
});
test('mood serializes concurrent sessions, rejects invented target IDs, and cancels delayed updates', async t => {
  const f = await setup(t); f.message(1); f.message(2, false, '安慰'); await f.drain();
  const group = f.store.data.chats['100:group:300'], target = f.store.data.chats['100:private:200'];
  assert.equal(f.memory.mood(group.sessionId).version, 2); assert.equal(f.evaluations.length, 2);
  f.memory.ingest(group.sessionId, [{ id: 'bad-target', actorId: 'qq:100:201', text: 'ordinary' }]);
  const bad = new LinkedMood(async () => ({ overall: delta(), targets: [{ actorId: 'qq:100:999', ...delta() }] }));
  assert.equal((await bad.assess(f.memory, {}, group.sessionId, ['bad-target'])).status, 'unavailable');
  assert.equal(f.memory.mood(target.sessionId).version, 2); bad.close();
  let resolve; const pending = new LinkedMood(() => new Promise(r => { resolve = r; }));
  const p = pending.assess(f.memory, {}, group.sessionId, ['bad-target']); await new Promise(r => setImmediate(r)); pending.close(); resolve({ overall: delta(5), targets: [] });
  assert.equal((await p).status, 'cancelled'); assert.equal(f.memory.mood(target.sessionId).version, 2);
});
test('interrupted contact is uncertain after restart and cannot be automatically replayed', async t => {
  const f = await setup(t); f.store.data.intents.one = { id: 'one', status: 'delivering' }; f.store.save();
  const restored = new Store(f.store.file); assert.equal(restored.data.intents.one.status, 'uncertain');
});
test('v1 upgrade preserves old mixed history and allocates a fresh linked live session', async t => {
  const f = await setup(t); const c = f.store.data.chats['100:group:300']; const old = c.sessionId;
  c.created = true; f.store.data.version = 1; f.store.save();
  const restored = new Store(f.store.file); assert.equal(restored.data.version, 2); assert.ok(fs.existsSync(f.store.file + '.v1.bak'));
  const upgraded = restored.data.chats[c.key]; assert.equal(upgraded.legacySessionId, old);
  f.bridge.store = restored; f.bridge.cooperation.route(upgraded);
  assert.notEqual(upgraded.sessionId, old); assert.equal(upgraded.created, false); assert.equal(upgraded.legacySessionId, old);
});
test('activity contact honors quiet policy, preserves privacy and routes to the current private session',async t=>{
  const f=await setup(t);f.cfg.replyToContact=true;let allowed=true;f.bridge.activityPolicy=()=>allowed;
  f.memory.people('nia',[{id:'qq:100:200',name:'用户'}]);
  f.memory.bind({sessionId:'nia-activity-test',personaId:'nia',chatId:'local:activity',actorIds:['qq:100:200'],ownerActorId:'qq:100:200',preview:false,transport:'activity'});
  f.memory.ingest('nia-activity-test',[{id:'private-activity',actorId:'qq:100:200',text:'不得转发'}]);
  const m=f.memory.remember('nia-activity-test',{text:'不得转发',subjects:['qq:100:200'],evidenceIds:['private-activity'],kind:'event',status:'reported',visibility:'private'});assert.ok(m.id);
  assert.throws(()=>f.bridge.cooperation.activityContact({sessionId:'nia-activity-test',actorId:'qq:100:200',reason:'不要泄漏',evidenceIds:['private-activity'],requestId:'private'}),/原聊天/);
  const intent=f.bridge.cooperation.activityContact({sessionId:'nia-activity-test',actorId:'qq:100:200',reason:'私密内容不得进入无证据联系',requestId:'hello'});
  assert.equal(f.store.data.intents[intent.id].reason,'想找对方聊聊');allowed=false;await f.drain();assert.equal(f.prompts.length,0);
  allowed=true;await f.drain();assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].sid,f.store.data.chats['100:private:200'].sessionId);
  assert.equal(f.store.data.intents[intent.id].status,'handled');
});
test('private conversation can request group contact, which wakes the group once and uses its send tool',async t=>{
  const f=await setup(t);f.cfg.replyToContact=true;f.message(10,false,'去群里聊聊');await f.drain();
  const source=f.store.data.chats['100:private:200'],group=f.store.data.chats['100:group:300'];
  const tool=f.host.agents.get(source.sessionId).tools.get('nia_qq_group_contact');assert.ok(tool);
  const args={groupId:'300',reason:'去群里打个招呼',requestId:'group-1'};
  await assert.rejects(()=>tool.execute({...args,groupId:'999'}),/未接入/);
  group.paused=true;await assert.rejects(()=>tool.execute(args),/暂停/);group.paused=false;
  const intent=await tool.execute(args);assert.equal(intent.status,'pending');
  assert.equal((await tool.execute(args)).repeated,true);await f.drain();
  assert.equal(f.store.data.intents[intent.id].status,'handled');
  assert.equal(f.prompts.filter(x=>x.sid===group.sessionId&&x.p.source.kind==='nia-contact').length,1);
  assert.equal(f.calls.filter(x=>x.action==='send_group_msg').length,1);
  await f.drain();assert.equal(f.calls.filter(x=>x.action==='send_group_msg').length,1);
});
test('autonomous group contact observes privacy, quiet, pending messages and per-group cooldown',async t=>{
  const f=await setup(t);f.bridge.activityPolicy=()=>true;f.cfg.replyToContact=true;
  f.memory.people('nia',[{id:'qq:100:200'}]);
  f.memory.bind({sessionId:'activity-group',personaId:'nia',chatId:'local:activity',actorIds:['qq:100:200'],preview:false,transport:'activity'});
  f.memory.ingest('activity-group',[{id:'private-group',actorId:'qq:100:200',text:'私密'}]);
  f.memory.remember('activity-group',{text:'私密',subjects:['qq:100:200'],evidenceIds:['private-group'],kind:'event',status:'reported',visibility:'private'});
  const base={sessionId:'activity-group',groupId:'300',reason:'想水群',requestId:'one'};
  assert.throws(()=>f.bridge.cooperation.groupContact(null,{...base,evidenceIds:['private-group']}),/原聊天/);
  f.bridge.activityPolicy=()=>false;assert.throws(()=>f.bridge.cooperation.groupContact(null,base),/安静/);f.bridge.activityPolicy=()=>true;
  const intent=f.bridge.cooperation.groupContact(null,base);assert.equal(intent.status,'pending');
  assert.throws(()=>f.bridge.cooperation.groupContact(null,{...base,requestId:'two'}),/刚主动/);
  f.message(11,true,'群里刚有消息');await f.drain();await f.drain();
  assert.equal(f.store.data.intents[intent.id].status,'handled');
  assert.equal(f.calls.filter(x=>x.action==='send_group_msg').length,1);
});
test('activity contact waits for the latest incoming message before waking the private session',async t=>{
  const f=await setup(t);f.bridge.activityPolicy=()=>true;
  f.memory.people('nia',[{id:'qq:100:200',name:'用户'}]);f.memory.bind({sessionId:'activity-test',personaId:'nia',chatId:'local:activity',actorIds:['qq:100:200'],preview:false,transport:'activity'});
  const i=f.bridge.cooperation.activityContact({sessionId:'activity-test',actorId:'qq:100:200',requestId:'hello'});
  f.message(1,false,'我刚回来了');await f.drain();assert.equal(f.store.data.intents[i.id].status,'pending');
  assert.equal(f.prompts[0].p.source.kind,'qq');await f.drain();assert.equal(f.prompts[1].p.source.kind,'nia-contact');
});
test('an explicit stop cancels an unprocessed activity contact rather than sending later',async t=>{
  const f=await setup(t);f.bridge.activityPolicy=()=>true;f.memory.people('nia',[{id:'qq:100:200',name:'用户'}]);
  f.memory.bind({sessionId:'activity-stop',personaId:'nia',chatId:'local:activity',actorIds:['qq:100:200'],preview:false,transport:'activity'});
  const i=f.bridge.cooperation.activityContact({sessionId:'activity-stop',actorId:'qq:100:200',requestId:'hello'});
  f.message(1,false,'先别发');assert.equal(f.store.data.intents[i.id].status,'discarded');await f.drain();await f.drain();
  assert.equal(f.prompts.filter(x=>x.p.source.kind==='nia-contact').length,0);
});
test('a persistent request not to initiate contact disables future activity contacts without pausing the chat',async t=>{
  const f=await setup(t);f.bridge.activityPolicy=()=>true;f.memory.people('nia',[{id:'qq:100:200'}]);
  f.memory.bind({sessionId:'activity-stop',personaId:'nia',chatId:'local:activity',actorIds:['qq:100:200'],preview:false,transport:'activity'});
  f.message(1,false,'以后不要主动找我');const c=f.store.data.chats['100:private:200'];assert.equal(c.activityContactsPaused,true);assert.equal(c.paused,false);
  assert.throws(()=>f.bridge.cooperation.activityContact({sessionId:'activity-stop',actorId:'qq:100:200',requestId:'hello'}),/暂停主动/);
});
