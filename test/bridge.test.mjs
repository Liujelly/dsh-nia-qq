import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, chatKey } from '../lib/store.js';
import { Bridge, plainMessage } from '../lib/bridge.js';
import { defaults, validateConfig } from '../lib/index.js';
import { Sessions, chatTitle, restoreModelOptions } from '../lib/sessions.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-qq-test-'));
  t.after(() => { if (!path.basename(dir).startsWith('nia-qq-test-') || path.dirname(dir) !== os.tmpdir()) throw new Error('bad cleanup'); fs.rmSync(dir, { recursive: true }); });
  const store = new Store(path.join(dir, 'state.json'));
  const cfg = { ...defaults, enabled: true, account: '100', batchMs: 0 };
  const calls = [], prompts = [];
  const api = { call: async (action, params) => { calls.push({ action, params });
    return ({ get_login_info: { user_id: 100 }, get_friend_list: [{ user_id: 200, nickname: 'Alice' }], get_group_list: [{ group_id: 300, group_name: 'Group' }] })[action] ?? { message_id: 900 }; } };
  const sessions = { ensure: async () => ({ whenIdle: async () => {}, followup: async p => prompts.push(p) }), flush: async () => {}, close: async () => {} };
  const bridge = new Bridge({ store, api, sessions, config: () => cfg });
  return { dir, store, cfg, calls, prompts, api, sessions, bridge };
}
const message = (id = 1, type = 'private', sender = 200) => ({ post_type: 'message', message_type: type, self_id: 100, user_id: sender, group_id: 300, message_id: id, time: 1, sender: { nickname: 'Alice' }, message: [{ type: 'text', data: { text: '你好' } }] });

test('quiet window follows the last message with a bounded maximum wait', async t=>{
  const f=fixture(t);await f.bridge.connect();Object.assign(f.cfg,{batchMs:3000,maxBatchMs:12000});
  const now=Date.now();f.bridge.event(message(1));f.store.data.inbox[0].at=now-4000;
  f.bridge.event(message(2));f.store.data.inbox[1].at=now-1000;
  assert.equal(f.bridge.batchReady(f.store.data.inbox,now),false,'first message age must not trigger early reply');
  assert.equal(f.bridge.batchReady(f.store.data.inbox,now+2100),true);
  f.bridge.tick();assert.equal(f.prompts.length,0);
  f.store.data.inbox[0].at=now-13000;
  assert.equal(f.bridge.batchReady(f.store.data.inbox,now),true,'continuous group activity cannot starve the batch');
  f.bridge.tick();await Promise.all(f.bridge.running.values());
  assert.equal(f.prompts.length,1);assert.match(f.prompts[0].content[0].text,/"messageId":"1".*"messageId":"2"/s);
});

test('new input while preparing an answer defers stale sends and stays queued exactly once', async t=>{
  const f=fixture(t);await f.bridge.connect();f.cfg.dryRun=false;
  const c=f.store.data.chats['100:private:200'];f.bridge.event(message(1));
  let deferred;
  f.sessions.ensure=async()=>({whenIdle:async()=>{},followup:async p=>{
    f.prompts.push(p);f.bridge.event(message(2));deferred=await f.bridge.say(c,'old answer','stale-reply');
  }});
  await f.bridge.deliver(c,f.store.data.inbox.slice());
  assert.equal(deferred.status,'deferred');assert.equal(deferred.sent,false);
  assert.equal(f.calls.some(x=>x.action==='send_private_msg'),false);
  assert.deepEqual(f.store.data.inbox.map(x=>x.status),['delivered','pending']);
  f.sessions.ensure=async()=>({whenIdle:async()=>{},followup:async p=>f.prompts.push(p)});
  await f.bridge.deliver(c,f.bridge.pendingMessages(c));
  await f.bridge.say(c,'combined answer','fresh-reply');
  assert.equal(f.calls.filter(x=>x.action==='send_private_msg').length,1);
  f.bridge.event(message(3));
  assert.equal((await f.bridge.say(c,'combined answer','fresh-reply')).repeated,true,'confirmed retries still return the existing receipt');
});

test('QQ identity follows configured account across nicknames and group directory is available',async t=>{
  const f=fixture(t);await f.bridge.connect();f.cfg.ownerQQ='200';
  f.bridge.event({...message(1,'group'),sender:{nickname:'totally changed',card:'new group card'}});
  const c=f.store.data.chats['100:group:300'];
  assert.equal(f.bridge.identityContext(c).participants[0].isConfiguredUser,true);
  f.cfg.ownerQQ='201';assert.equal(f.bridge.identityContext(c).participants[0].isConfiguredUser,false);
  const chats=f.bridge.chats(c);assert.ok(chats.some(x=>x.type==='group'&&x.name==='Group'&&x.chatId==='qq:100:group:300'));
  assert.ok(chats.some(x=>x.type==='private'));assert.equal(chats.length,2);
});

test('roster discovery allocates stable IDs without model calls; reconnect retains paused flag', async t => {
  const f = fixture(t); await f.bridge.connect(); assert.equal(Object.keys(f.store.data.chats).length, 2); assert.equal(f.prompts.length, 0);
  const c = f.store.data.chats['100:group:300']; c.paused = true; const id = c.sessionId;
  await f.bridge.connect(); assert.equal(c.sessionId, id); assert.equal(c.paused, true);
});
test('first stranger message binds automatically, deduplicates and persists across restart', async t => {
  const f = fixture(t); await f.bridge.connect(); const e = message(42, 'private', 201);
  f.bridge.event(e); f.bridge.event(e); assert.equal(f.store.data.inbox.length, 1);
  const id = f.store.data.chats['100:private:201'].sessionId;
  f.bridge.tick(); await Promise.all(f.bridge.running.values()); assert.equal(f.prompts.length, 1);
  const restored = new Store(f.store.file); assert.equal(restored.data.chats['100:private:201'].sessionId, id);
  assert.equal(restored.enqueue(restored.data.chats['100:private:201'], e), false);
});
test('private/group and accounts remain distinct; person address shared without histories', async t => {
  const f = fixture(t); await f.bridge.connect(); f.bridge.event(message()); f.bridge.event(message(2, 'group'));
  const p = f.store.data.chats['100:private:200'], g = f.store.data.chats['100:group:300'];
  f.bridge.alias(p, '200', '阿青'); f.bridge.tick(); await Promise.all(f.bridge.running.values());
  assert.equal(f.prompts.length, 2); assert.notEqual(p.sessionId, g.sessionId);
  assert.ok(f.prompts.every(x => x.content[0].text.includes('阿青')));
  assert.notEqual(chatKey(100, 'private', 200), chatKey(101, 'private', 200));
});
test('self messages, message_sent, foreign accounts and requests do not create turns', async t => {
  const f = fixture(t); await f.bridge.connect();
  for (const e of [{ ...message(), user_id: 100 }, { ...message(), post_type: 'message_sent' }, { ...message(), self_id: 999 }, { ...message(), post_type: 'request' }]) f.bridge.event(e);
  assert.equal(f.store.data.inbox.length, 0);
});
test('friend add and own join bind; other member joining does not create unknown group; leave deactivates', async t => {
  const f = fixture(t); await f.bridge.connect();
  f.bridge.event({ post_type: 'notice', self_id: 100, notice_type: 'friend_add', user_id: 202 });
  f.bridge.event({ post_type: 'notice', self_id: 100, notice_type: 'group_increase', user_id: 999, group_id: 301 });
  assert.ok(f.store.data.chats['100:private:202']); assert.equal(f.store.data.chats['100:group:301'], undefined);
  f.bridge.event({ post_type: 'notice', self_id: 100, notice_type: 'group_increase', user_id: 100, group_id: 301 });
  assert.ok(f.store.data.chats['100:group:301'].active);
  f.bridge.event({ post_type: 'notice', self_id: 100, notice_type: 'group_decrease', user_id: 100, group_id: 301 });
  assert.equal(f.store.data.chats['100:group:301'].active, false);
});
test('pause retains incoming messages but prevents delivery and sending', async t => {
  const f = fixture(t); await f.bridge.connect(); const c = f.store.data.chats['100:private:200']; c.paused = true;
  f.bridge.event(message()); f.bridge.tick(); assert.equal(f.bridge.running.size, 0); assert.equal(f.store.data.inbox[0].status, 'pending');
  await assert.rejects(f.bridge.say(c, 'hi', 'one')); c.paused = false; f.bridge.tick(); await Promise.all(f.bridge.running.values()); assert.equal(f.prompts.length, 1);
});
test('preview never sends or renames; real sends are text segments, not CQ execution', async t => {
  const f = fixture(t); await f.bridge.connect(); const c = f.store.data.chats['100:private:200'];
  const before = f.calls.length; assert.equal((await f.bridge.say(c, '[CQ:at,qq=all]', 'one')).status, 'preview');
  await f.bridge.rename(c, 'profile', '妮娅', '', 'two'); assert.equal(f.calls.length, before);
  f.cfg.dryRun = false; await f.bridge.say(c, '[CQ:at,qq=all]', 'one');
  assert.deepEqual(f.calls.at(-1).params.message, [{ type: 'text', data: { text: '[CQ:at,qq=all]' } }]);
});
test('idempotency survives restart, concurrent repeated tool calls send once, mismatched text rejected', async t => {
  const f = fixture(t); await f.bridge.connect(); f.cfg.dryRun = false; const c = f.store.data.chats['100:private:200'];
  await Promise.all([f.bridge.say(c, 'hi', 'id1'), f.bridge.say(c, 'hi', 'id1')]);
  assert.equal(f.calls.filter(x => x.action === 'send_private_msg').length, 1);
  await assert.rejects(f.bridge.say(c, 'different', 'id1'));
  const restored = new Store(f.store.file); const b = new Bridge({ store: restored, api: f.api, sessions: f.sessions, config: () => f.cfg });
  await b.connect(); assert.equal((await b.say(restored.data.chats[c.key], 'hi', 'id1')).repeated, true);
  assert.equal(f.calls.filter(x => x.action === 'send_private_msg').length, 1);
});
test('unknown outbound results remain unknown and do not auto resend', async t => {
  const f = fixture(t); await f.bridge.connect(); f.cfg.dryRun = false; let attempts = 0;
  f.api.call = async () => { attempts++; throw new Error('timeout'); };
  const c = f.store.data.chats['100:private:200']; await assert.rejects(f.bridge.say(c, 'hi', 'id1'));
  assert.equal((await f.bridge.say(c, 'hi', 'id1')).status, 'uncertain'); assert.equal(attempts, 1);
});
test('group card always targets self; remarks require known friend; alias cannot target other chat', async t => {
  const f = fixture(t); await f.bridge.connect(); f.cfg.dryRun = false;
  const g = f.store.data.chats['100:group:300']; await f.bridge.rename(g, 'card', '妮娅', '999', 'card1');
  assert.equal(f.calls.at(-1).params.user_id, 100);
  assert.throws(() => f.bridge.alias(g, '200', '陌生人'));
  f.bridge.event(message(1, 'group')); await f.bridge.rename(g, 'friend', '阿青', '200', 'remark1'); assert.equal(f.calls.at(-1).action, 'set_friend_remark');
});
test('failed creation is retryable; possible followup acceptance is uncertain; corrupted state not reset', async t => {
  const f = fixture(t); await f.bridge.connect(); f.bridge.event(message());
  const c = f.store.data.chats['100:private:200'];
  f.sessions.ensure = async () => { throw new Error('missing model'); };
  await assert.rejects(f.bridge.deliver(c, f.store.data.inbox)); assert.equal(f.store.data.inbox[0].status, 'failed');
  f.store.data.inbox[0].status = 'pending';
  f.sessions.ensure = async () => ({ whenIdle: async () => {}, followup: async () => { throw new Error('unknown'); } });
  await assert.rejects(f.bridge.deliver(c, f.store.data.inbox)); assert.equal(f.store.data.inbox[0].status, 'uncertain');
  fs.writeFileSync(f.store.file, '{bad'); assert.throws(() => new Store(f.store.file)); assert.equal(fs.readFileSync(f.store.file, 'utf8'), '{bad');
});
test('crash states recover conservatively; unsupported media is not hallucinated as read', t => {
  const f = fixture(t); f.store.data.inbox.push({ status: 'delivering' }); f.store.data.actions.test = { status: 'sending' }; f.store.save();
  const restored = new Store(f.store.file); assert.equal(restored.data.inbox[0].status, 'uncertain'); assert.equal(restored.data.actions.test.status, 'uncertain');
  assert.match(plainMessage({ message: [{ type: 'image', data: { url: 'http://private' } }, { type: 'record' }] }), /未读取.*未转写/);
});
test('configuration rejects remote endpoints and incomplete activation; blank token preserves secret', t => {
  const f = fixture(t);
  assert.throws(() => validateConfig({ wsUrl: 'ws://example.com/' })); assert.throws(() => validateConfig({ enabled: true }));
  assert.equal(validateConfig({ token: '' }, { ...defaults, token: 'secret' }).token, 'secret');
  assert.equal(validateConfig({ clearToken: true }, { ...defaults, token: 'secret' }).token, '');
  assert.equal(validateConfig({ workspace: f.dir }).workspace, f.dir);
});

function fakeDSH() {
  const saved = new Map(), live = new Map(), registrations = [], calls = [];
  const ctx = {
    agents: { get: id => live.get(id), list: () => [...live.values()], create: opts => open(opts, false), resume: opts => open(opts, true) },
    sessionPersistence: { stat: async id => saved.get(id), flush: async () => {} },
    agentPresets: { mount: async (_ctx, id) => { calls.push(['mount', id]); return { id: id || 'standard' }; } },
    sessionProjections: { stateOf: (session,key) => key === 'agentPreset' ? saved.get(session.id)?.preset : saved.get(session.id)?.modelSelection }, get(name) { return this[name]; }
  };
  async function open(opts, resume) {
    calls.push([resume ? 'resume' : 'create', opts]); const id = opts.sessionId || opts.resumeSessionId;
    const agent = { id, options: {...opts.agentOptions}, session: { id, header: { cwd: opts.meta?.cwd || 'previous' }, requestHeader: () => saved.get(id)?.header, snapshotEvents: () => saved.get(id)?.events || [], append: (_type, data) => { saved.set(id, { ...saved.get(id), preset: data.agentPreset }); } },
      ctx: { tools: { register: t => { registrations.push(t); return () => {}; } }, systemPrompt: { section: s => { registrations.push(s); return () => {}; } } }, whenIdle: async () => {}, followup: async () => {} };
    await opts.setup(agent.ctx, agent); saved.set(id, saved.get(id) || {}); live.set(id, agent);
    return { agent, dispose: async () => { live.delete(id); } };
  }
  return { ctx, saved, live, registrations, calls };
}
test('QQ sessions register under the configured character workspace with durable titles', async t => {
  const f=fixture(t),host=fakeDSH(),projects=new Map(),titles=new Map();
  Object.assign(f.cfg,{provider:'p',model:'m',workspace:f.dir,characterName:'妮娅',dryRun:false});
  host.ctx.workspaceRegistry={create:async(cwd,title)=>{
    if(!projects.has(cwd))projects.set(cwd,{title,ids:new Set(),attachSession:async id=>projects.get(cwd).ids.add(id)});
    return projects.get(cwd);
  }};
  host.ctx.sessionTitle={get:session=>titles.get(session.id),rename:(session,title)=>titles.set(session.id,{title})};
  const s=new Sessions(host.ctx,f.store,()=>f.cfg); t.after(()=>s.close());
  await s.prepareWorkspace();
  const a=f.store.chat(100,'private',200,'朋友'),b=f.store.chat(100,'group',300,'测试群');
  await s.ensure(a,f.bridge);await s.ensure(b,f.bridge);
  assert.equal(projects.size,1);assert.equal(projects.get(f.dir).title,'妮娅');
  assert.deepEqual([...projects.get(f.dir).ids],[a.sessionId,b.sessionId]);
  assert.equal(titles.get(a.sessionId).title,'QQ 私聊 · 朋友');
  assert.equal(titles.get(b.sessionId).title,'QQ 群聊 · 测试群');
  titles.set(a.sessionId,{title:'我自己起的名字'});await s.ensure(a,f.bridge);
  assert.equal(titles.get(a.sessionId).title,'我自己起的名字');
  assert.match(chatTitle(a,true),/^预演 · QQ 私聊/);
  assert.ok(Buffer.byteLength(chatTitle({...a,name:'很长的名字'.repeat(50)}))<=96);
});
test('session resume restores prompt model variables before publish and preserves the recorded model', async t => {
  const f = fixture(t), host = fakeDSH(); Object.assign(f.cfg, { provider: 'p', model: 'm', preset: 'nia', workspace: f.dir });
  const s = new Sessions(host.ctx, f.store, () => f.cfg), c = f.store.chat(100, 'private', 200);
  await Promise.all([s.ensure(c, f.bridge), s.ensure(c, f.bridge)]);
  assert.equal(host.calls.filter(x => x[0] === 'create').length, 1); assert.ok(c.created);
  assert.ok(host.registrations.find(x => x.name === 'nia_qq_say')); assert.equal(host.saved.get(c.sessionId).preset, 'nia');
  host.saved.get(c.sessionId).header = {config:{provider:'p',model:'m',reasoningEffort:'low'}};
  await s.close();
  const next = new Sessions(host.ctx, f.store, () => ({ ...f.cfg, model: 'changed', preset: 'changed' })); await next.ensure(c, f.bridge);
  assert.equal(host.calls.at(-1)[0], 'mount'); assert.equal(host.calls.at(-1)[1], 'nia');
  assert.deepEqual(host.calls.find(x => x[0] === 'resume')[1].agentOptions, {provider:'p',model:'changed'});
  assert.deepEqual(host.live.get(c.sessionId).options, {provider:'p',model:'m',reasoningEffort:'low'});
  await next.close();
});

test('resume honors a pending selection, falls back for never-started sessions, and rejects missing models', () => {
  const fallback={provider:'configured',model:'fallback'};
  const agent={options:{},session:{requestHeader:()=>({config:{provider:'old',model:'previous',reasoningEffort:'high'},adapterDefaults:{reasoningEffort:true}})}};
  assert.deepEqual(restoreModelOptions(agent,fallback),{provider:'old',model:'previous'});
  assert.deepEqual(restoreModelOptions(agent,fallback,{pending:{provider:'new',model:'chosen',reasoningEffort:'low'}}),{provider:'new',model:'chosen',reasoningEffort:'low'});
  agent.session.snapshotEvents=()=>[{type:'request/header'}, {type:'model/selection',data:{provider:'event',model:'pending'}}];
  assert.deepEqual(restoreModelOptions(agent,fallback),{provider:'event',model:'pending'});
  agent.session={};
  assert.deepEqual(restoreModelOptions(agent,fallback),fallback);
  assert.throws(()=>restoreModelOptions(agent,{}),/缺少模型/);
});

test('an already-live broken QQ session is repaired without replacing its history or valid model choices', async t => {
  const f=fixture(t),host=fakeDSH();Object.assign(f.cfg,{provider:'p',model:'m',workspace:f.dir});
  const s=new Sessions(host.ctx,f.store,()=>f.cfg);t.after(()=>s.close());
  const c=f.store.chat(100,'private',200);const agent=await s.ensure(c,f.bridge),originalSession=agent.session;
  host.saved.get(c.sessionId).header={config:{provider:'saved',model:'prior'}};agent.options={};
  assert.equal(await s.ensure(c,f.bridge),agent);assert.equal(agent.session,originalSession);
  assert.deepEqual(agent.options,{provider:'saved',model:'prior'});
  agent.options={provider:'picked',model:'current'};await s.ensure(c,f.bridge);
  assert.deepEqual(agent.options,{provider:'picked',model:'current'});
  assert.equal(host.calls.filter(x=>['create','resume'].includes(x[0])).length,1);
});
test('missing previously created session never silently starts empty context', async t => {
  const f = fixture(t), host = fakeDSH(), c = f.store.chat(100, 'private', 200); c.created = true;
  const s = new Sessions(host.ctx, f.store, () => f.cfg); await assert.rejects(s.ensure(c, f.bridge), /拒绝/); assert.equal(host.calls.length, 0);
});
test('messages discarded during session startup are not delivered', async t => {
  const f = fixture(t); await f.bridge.connect(); f.bridge.event(message());
  f.sessions.ensure = async () => { f.store.data.inbox[0].status = 'discarded'; return { whenIdle: async () => {}, followup: async () => assert.fail('discarded message sent') }; };
  await f.bridge.deliver(f.store.data.chats['100:private:200'], f.store.data.inbox); assert.equal(f.store.data.inbox[0].status, 'discarded');
});
