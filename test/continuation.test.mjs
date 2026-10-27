import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../lib/store.js';
import { Sessions } from '../lib/sessions.js';
import { Bridge } from '../lib/bridge.js';
import { defaults, validateConfig } from '../lib/index.js';
import { Continuation, terminalOverflow, handoffInput, summarizeHandoff } from '../lib/continuation.js';
import { Database } from '../../dsh-nia-memory/lib/store.js';
import { Memory } from '../../dsh-nia-memory/lib/core.js';
import { attachMemory } from '../../dsh-nia-memory/lib/index.js';
import { LinkedMood } from '../../dsh-nia-mood/lib/linked.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const overflow = (turn = 1) => ({ type: 'turn/end', data: { turn, reason: { kind: 'error', error: { code: 'CONTEXT_WINDOW_EXCEEDED' } } } });
async function setup(t, preview = false, type = 'private') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-continuation-'));
  const cfg = { ...defaults, enabled: true, cooperate: true, dryRun: preview, provider: 'configured', model: 'fallback',
    workspace: dir, account: '100', ownerQQ: '200', preset: 'standard', batchMs: 0 };
  const db = new Database(path.join(dir, 'memory')), memory = new Memory(db), offs = [], mounted = new WeakSet();
  memory.attach = (a, b) => { memory.bind(b); if (!mounted.has(a)) { attachMemory(memory, a, b, offs); mounted.add(a); } };
  const mood = new LinkedMood(async () => ({ overall: { moodDelta: 0, dims: {}, confidence: 90, reason: '无新增变化' }, targets: [] }));
  const saved = new Map(), live = new Map(), prompts = [], reports = [], calls = [];
  let b, flushHook = () => {}, createHook = () => {};
  const ctx = { get(n) { return this[n]; }, niaMemory: memory, niaMood: mood,
    agentPresets: { mount: async (_ctx, id) => ({ id: id || 'standard' }) },
    sessionProjections: { stateOf: (s, key) => key === 'agentPreset' ? s.snapshotEvents().filter(e => e.type === 'agent-preset/selected').at(-1)?.data.agentPreset : undefined },
    sessionPersistence: { stat: async id => saved.get(id), flush: async () => flushHook() },
    agents: { get: id => live.get(id), list: () => [...live.values()], create: opts => open(opts), resume: opts => open(opts) } };
  async function open(opts) {
    createHook(opts);
    const id = opts.sessionId || opts.resumeSessionId, log = saved.get(id)?.log || [], tools = new Map(), sections = new Map();
    const a = { id, options: { ...opts.agentOptions }, inbox: { hasPending: false }, status: 'idle',
      session: { id, header: { cwd: dir }, snapshotEvents: () => log.slice(), requestHeader: () => undefined,
        append(type, data) {
          if (type === 'user/message') { assert.equal(data.role, 'user', 'DSH canonical user/message payload'); assert.ok(Array.isArray(data.content)); }
          const e = { seq: log.length, time: Date.now(), type, data }; log.push(e); b?.sessionEvent(this, e); return e;
        } },
      ctx: { tools: { register: d => { tools.set(d.name, d); return () => tools.delete(d.name); } },
        systemPrompt: { section: d => { sections.set(d.name, d); return () => sections.delete(d.name); }, context: d => { sections.set(d.name, d); return () => sections.delete(d.name); } } },
      tools, sections, whenIdle: async () => {}, runMaintenance: async fn => {
        assert.equal(a.status, 'idle'); a.status = 'maintenance'; try { return await fn(new AbortController().signal); } finally { a.status = 'idle'; }
      },
      followup: async message => { prompts.push({ sid: id, message }); a.session.append('user/message', message); } };
    await opts.setup(a.ctx, a); saved.set(id, { log }); live.set(id, a);
    return { agent: a, dispose: async () => { live.delete(id); } };
  }
  const store = new Store(path.join(dir, 'qq.json')), sessions = new Sessions(ctx, store, () => cfg);
  b = new Bridge({ store, sessions, config: () => cfg, api: { call: async (name, params) => { calls.push({ name, params }); return { message_id: 900 }; } }, report: x => reports.push(x) });
  b.account = '100'; b.ready = true;
  store.person('100', '200', '用户', true); store.person('100', '201', '群友', false);
  const c = store.chat('100', type, type === 'private' ? '200' : '300', '聊天'); c.members = ['200','201'];
  const a = await sessions.ensure(c, b), sid = a.id;
  a.options = { provider: 'chosen', model: 'selected', reasoningEffort: 'low' };
  a.session.append('agent-preset/selected', { agentPreset: 'original-preset' });
  b.continuation.summarize = async () => '正在讨论晚上的游戏；用户说稍后回来，尚未约定时间。之前一句玩笑让你不快，已经解释。';
  const add = (id = '1', text = '今晚玩什么', user = '200') => b.event({ post_type: 'message', self_id: 100, message_type: type,
    group_id: 300, user_id: user, message_id: id, time: Date.now() / 1000, sender: { nickname: user === '200' ? '用户' : '群友' }, message: text });
  const failedTurn = (tool = false) => {
    a.session.append('turn/start', { turn: 1 });
    a.session.append('user/message', { id: 'input', role: 'user', source: { kind: 'qq' }, content: [{ type: 'text', text: 'QQ数据\n' + JSON.stringify({ messages: [{ actorId: 'qq:100:200', text: '你想玩什么' }] }) }] });
    if (tool) {
      a.session.append('tool/call', { name: 'some_tool', callId: 'one' });
      a.session.append('tool/result', { message: { source: { callId: 'one' }, content: [{type:'text',text:'工具返回，不等于计划完成'}] } });
    }
    const e = overflow(); a.session.append(e.type, e.data);
  };
  const tick = async () => { b.tick(); await Promise.all(b.running.values()); };
  t.after(async () => { await b.stop(); mood.close(); for (const off of offs.reverse()) off?.(); db.close();
    assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('nia-continuation-')); fs.rmSync(dir, { recursive: true }); });
  return { b, c, a, sid, cfg, ctx, store, sessions, saved, live, memory, db, mood, prompts, reports, calls, failedTurn, add, tick,
    setFlush: f => { flushHook = f; }, setCreate: f => { createHook = f; } };
}

test('manual continuation preserves private memory and emotional version, model and preset; old tools cannot send', async t => {
  const f = await setup(t), oldSay = f.a.tools.get('nia_qq_say');
  f.memory.ingest(f.sid, [{ id: 'source', actorId: 'qq:100:200', text: '只在这里说的事' }]);
  await f.mood.assess(f.memory, f.a, f.sid, ['source']);
  const m = f.memory.remember(f.sid, { text: '只在这里说的事', subjects: ['qq:100:200'], evidenceIds: ['source'], kind: 'event', status: 'reported', visibility: 'private' });
  const moodBefore = f.memory.mood(f.sid), eventsBefore = Object.keys(f.db.data.events);
  f.b.continuation.request(f.c); await f.tick();
  const j = f.b.continuation.job(f.c), next = f.live.get(f.c.sessionId);
  assert.equal(j.status, 'committed', j.error); assert.notEqual(f.c.sessionId, f.sid);
  assert.deepEqual(next.options, f.a.options); assert.ok(next.session.snapshotEvents().some(e => e.type === 'agent-preset/selected' && e.data.agentPreset === 'original-preset'));
  assert.equal(f.c.sessionHistory[0].id, f.sid); assert.ok(f.saved.has(f.sid)); assert.equal(f.live.has(f.sid), false);
  assert.equal(f.memory.binding(next.id).chatId, f.memory.binding(f.sid).chatId);
  assert.ok(f.memory.recall(next.id, '只在这里').some(x => x.id === m.id));
  assert.deepEqual(f.memory.mood(next.id), moodBefore); assert.deepEqual(Object.keys(f.db.data.events), eventsBefore);
  assert.equal(f.prompts.length, 0); assert.equal(f.calls.length, 0);
  assert.throws(() => oldSay.execute({ text: '不该发送', requestId: 'old' }), /旧会话/);
});

test('terminal overflow auto switches once, wakes a tool-free QQ turn once, and cools down', async t => {
  const f = await setup(t); f.failedTurn();
  assert.equal(f.b.continuation.job(f.c).status, 'queued');
  await f.tick(); const j = f.b.continuation.job(f.c);
  assert.equal(j.status, 'committed', j.error); assert.equal(j.wake, 'pending');
  await f.tick(); assert.equal(f.prompts.length, 1); assert.equal(f.prompts[0].message.source.kind, 'nia-continuation');
  await f.tick(); assert.equal(f.prompts.length, 1); assert.equal(j.wake, 'done');
  f.b.sessionEvent({ id: f.c.sessionId }, overflow(2)); assert.equal(f.b.continuation.job(f.c).id, j.id);
  assert.equal(f.calls.length, 0, 'no platform send during handoff preparation');
});

test('normal compression, timeouts, limits and unknown errors never trigger a new session; setting can disable fallback', async t => {
  const f = await setup(t);
  for (const code of ['TIMEOUT','RATE_LIMIT','UNKNOWN','TRANSPORT','AUTH','MAX_TOKENS']) f.b.sessionEvent(f.a.session, { type: 'turn/end', data: { reason: { kind: 'error', error: { code } } } });
  f.b.sessionEvent(f.a.session, { type: 'compaction/end', data: {} });
  assert.equal(f.b.continuation.job(f.c), undefined); assert.equal(f.c.sessionId, f.sid);
  f.cfg.autoContinue = false; f.failedTurn(); assert.equal(f.b.continuation.job(f.c), undefined);
  assert.throws(() => validateConfig({ autoContinue: 'yes' }), /布尔/);
  assert.equal(terminalOverflow({ type: 'turn/end', data: { reason: { kind: 'completed' } } }), false);
});

test('new QQ input arriving during summary remains queued and supersedes an automatic old reply', async t => {
  const f = await setup(t), entered = deferred(), finish = deferred();
  f.b.continuation.summarize = async () => { entered.resolve(); await finish.promise; return '交接'; };
  f.failedTurn(); f.b.tick(); await entered.promise;
  f.add('22', '等我说完'); assert.equal(f.store.data.inbox.at(-1).status, 'pending');
  finish.resolve(); await Promise.all(f.b.running.values());
  const j = f.b.continuation.job(f.c); assert.equal(j.status, 'committed', j.error);
  await f.tick(); assert.equal(j.wake, 'skipped'); assert.equal(f.prompts.length, 0);
  await f.tick(); assert.equal(f.prompts.length, 1); assert.equal(f.prompts[0].message.source.kind, 'qq');
  assert.equal(f.store.data.inbox.at(-1).status, 'delivered');
});

test('tool use before overflow prevents automatic replay after the successful switch', async t => {
  const f = await setup(t); f.failedTurn(true); await f.tick(); await f.tick();
  assert.equal(f.b.continuation.job(f.c).wake, 'skipped'); assert.equal(f.prompts.length, 0);
});

test('summary failure keeps original binding and queue; manual retry generates a fresh candidate', async t => {
  const f = await setup(t); f.add(); f.b.continuation.summarize = async () => { throw Error('summary failure'); };
  f.b.continuation.request(f.c); const first = f.b.continuation.job(f.c).to; await f.tick();
  assert.equal(f.c.sessionId, f.sid); assert.equal(f.b.continuation.job(f.c).status, 'failed');
  assert.equal(f.store.data.inbox[0].status, 'pending'); assert.equal(f.live.size, 1);
  f.b.continuation.control(f.c, 'retry'); assert.notEqual(f.b.continuation.job(f.c).to, first);
  f.b.continuation.summarize = async () => '重新整理'; await f.tick(); assert.equal(f.b.continuation.job(f.c).status, 'committed');
});

test('new session persistence failure and concurrent desktop input leave original conversation active', async t => {
  const f = await setup(t); f.b.continuation.request(f.c);
  f.setFlush(() => { throw new AggregateError([Object.assign(new Error('EACCES: session write denied'),{code:'EACCES'})], 'session-persistence-jsonl flush failed'); }); await f.tick();
  assert.equal(f.c.sessionId, f.sid); assert.equal(f.b.continuation.job(f.c).status, 'failed');
  assert.match(f.b.continuation.job(f.c).error, /EACCES: session write denied/);
  f.setFlush(() => {}); f.b.continuation.control(f.c, 'retry');
  f.b.continuation.summarize = async () => { f.a.session.append('user/message', { id: 'desktop', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '新输入' }] }); return '旧摘要'; };
  await f.tick(); assert.equal(f.c.sessionId, f.sid); assert.match(f.b.continuation.job(f.c).error, /新操作/);
});

test('uncertain platform actions block continuation; interrupted journals do not silently retry', async t => {
  const f = await setup(t); f.store.data.actions[f.c.key + ':live:unknown'] = { key: f.c.key + ':live:unknown', chat: f.c.key, status: 'uncertain' };
  f.b.continuation.request(f.c); await f.tick(); assert.equal(f.c.sessionId, f.sid); assert.match(f.b.continuation.job(f.c).error, /待核实/);
  const j = f.b.continuation.job(f.c); j.status = 'prepared'; j.wake = 'delivering'; f.store.save();
  f.b.continuation = new Continuation(f.b);
  assert.equal(j.status, 'failed'); assert.equal(j.wake, 'uncertain'); assert.equal(f.b.continuation.needsWork(f.c), false);
  f.b.continuation.control(f.c, 'acknowledge'); assert.equal(j.wake, 'skipped');
});

test('commit write failure rolls back the active pointer on disk and in memory', async t => {
  const f = await setup(t); f.b.continuation.request(f.c);
  const save = f.store.save.bind(f.store);
  f.store.save = () => { if (f.b.continuation.job(f.c)?.status === 'committed') throw Error('commit disk failure'); return save(); };
  await f.tick(); assert.equal(f.c.sessionId, f.sid); assert.equal(f.b.continuation.job(f.c).status, 'failed');
  const disk = JSON.parse(fs.readFileSync(f.store.file,'utf8')); assert.equal(disk.chats[f.c.key].sessionId, f.sid);
  assert.equal(disk.chats[f.c.key].sessionHistory.length, 0);
});

test('busy agent is allowed to finish before exclusive handoff, and another chat continues independently', async t => {
  const f = await setup(t), finish = deferred(), entered = deferred();
  let waits=0;
  f.a.whenIdle=async()=>{if(waits++===0){entered.resolve();await finish.promise;}};
  f.b.continuation.request(f.c); f.b.tick(); await entered.promise;
  assert.equal(f.c.sessionId,f.sid);assert.equal(f.b.continuation.job(f.c).status,'queued');
  const other=f.store.chat('100','group','301','另一群');other.members=['200'];
  f.b.event({post_type:'message',self_id:100,message_type:'group',group_id:301,user_id:200,message_id:'88',message:'另一群消息'});
  f.b.tick(); await f.b.running.get(other.key); assert.equal(f.prompts.length,1);
  finish.resolve(); await Promise.all(f.b.running.values()); assert.equal(f.b.continuation.job(f.c).status,'committed');
});

test('switch preparation is cancelled by shutdown; queued auto work obeys a later disabled setting', async t => {
  const f=await setup(t),entered=deferred();
  f.b.continuation.summarize=async(_ctx,_a,_data,signal)=>{entered.resolve();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('取消')),{once:true}));};
  f.b.continuation.request(f.c);f.b.tick();await entered.promise;f.b.abort.abort();await Promise.all(f.b.running.values());
  assert.equal(f.c.sessionId,f.sid);assert.equal(f.b.continuation.job(f.c).status,'failed');
  const other=await setup(t);other.failedTurn();other.cfg.autoContinue=false;await other.tick();
  assert.equal(other.c.sessionId,other.sid);assert.equal(other.b.continuation.job(other.c).status,'cancelled');
});

test('restart of a committed handoff retains its target and never repeats an uncertain wake',async t=>{
  const f=await setup(t);f.failedTurn();await f.tick();const sid=f.c.sessionId,j=f.b.continuation.job(f.c);
  f.b.continuation=new Continuation(f.b);await f.tick();assert.equal(f.c.sessionId,sid);assert.equal(f.prompts.length,1);
  j.wake='delivering';f.b.continuation=new Continuation(f.b);await f.tick();assert.equal(j.wake,'uncertain');assert.equal(f.prompts.length,1);
});

test('preview continuation never changes live session or sees live receipts; other groups keep separate identity', async t => {
  const f = await setup(t, true, 'group'), liveSid = f.c.sessionId;
  f.store.data.actions[f.c.key + ':live:secret'] = { key: f.c.key + ':live:secret', chat: f.c.key, status: 'confirmed', params: { message: [{ type: 'text', data: { text: '正式私密内容' } }] } };
  const input = handoffInput(f.a, f.b, f.c, 'preview'); assert.equal(input.preview, true); assert.equal(input.receipts.length, 0);
  assert.deepEqual(input.people.map(p => p.actorId), ['qq:100:200','qq:100:201']);
  f.b.continuation.request(f.c); await f.tick(); assert.equal(f.c.sessionId, liveSid); assert.notEqual(f.c.previewSessionId, f.sid);
  assert.equal(f.memory.binding(f.c.previewSessionId).preview, true); assert.equal(f.memory.binding(f.c.previewSessionId).chatId, 'qq:100:group:300');
});

test('canonical DSH input retains reply focus and runtime memory contexts do not replace the active turn', async t => {
  const f = await setup(t); f.add(); const item = f.store.data.inbox[0], turn = f.b.rhythm.begin(f.c, [item], item.id);
  f.b.sessionEvent(f.a.session, { type: 'user/message', data: { id: item.id, source: { kind: 'qq' } } });
  assert.equal(f.b.turns.get(f.c.key), turn); assert.deepEqual(turn.focusUsers, ['200']);
  f.b.sessionEvent(f.a.session, { type: 'user/message', data: { source: { kind: 'runtime-context' } } });
  assert.equal(f.b.turns.get(f.c.key), turn);
});

test('handoff distinguishes receipts, old checkpoints and unsent assistant prose', async t => {
  const f = await setup(t);
  f.a.session.append('user/message', { id: 'one', role: 'user', source: { kind: 'qq' }, content: [{ type: 'text', text: '真实输入' }] });
  f.a.session.append('assistant/message', { message: { content: [{ type: 'text', text: '尚未发送的回复' }] } });
  f.a.session.append('user/message', { id: 'checkpoint', role: 'user', source: { kind: 'compact-checkpoint' }, content: [{ type: 'text', text: '较早事项摘要' }] });
  const input = handoffInput(f.a, f.b, f.c, 'live'); assert.match(JSON.stringify(input), /较早事项摘要/); assert.doesNotMatch(JSON.stringify(input), /尚未发送的回复/);
});

test('missing tool receipt prevents handoff instead of implying an operation completed',async t=>{
  const f=await setup(t);f.a.session.append('tool/call',{callId:'missing',name:'write_file'});
  f.b.continuation.request(f.c);await f.tick();assert.equal(f.c.sessionId,f.sid);assert.match(f.b.continuation.job(f.c).error,/缺少回执/);
  f.b.continuation.control(f.c,'cancel');assert.equal(f.b.continuation.job(f.c).status,'cancelled');
  f.b.continuation.request(f.c);assert.equal(f.b.continuation.job(f.c).status,'queued');
});

test('reviewed uncertain receipts allow handoff but never become successful sends or automatic replays',async t=>{
  const f=await setup(t),key=f.c.key+':live:reviewed';
  f.store.data.actions[key]={key,chat:f.c.key,status:'uncertain',at:Date.now(),continuationReviewedAt:Date.now(),params:{}};
  f.b.continuation.request(f.c);await f.tick();assert.equal(f.b.continuation.job(f.c).status,'committed');
  assert.equal(f.store.data.actions[key].status,'uncertain');assert.equal(f.calls.length,0);assert.equal(f.prompts.length,0);
});

test('summary side-call has no tools, uses actual model, requires complete finish and responds to cancellation', async () => {
  let request;
  const ctx = { llm: { stream: async function* (r) { request = r; yield { type: 'text-delta', text: '交接内容' }; yield { type: 'finish', reason: { kind: 'stop' } }; } } };
  const a = { options: { provider: 'p', model: 'm' }, session: {} };
  assert.equal(await summarizeHandoff(ctx, a, { recentInput: [] }, new AbortController().signal), '交接内容');
  assert.equal(request.provider, 'p'); assert.equal(request.model, 'm'); assert.equal(request.tools, undefined); assert.equal(request.sessionId, undefined);
  ctx.llm.stream = async function* () { yield { type: 'text-delta', text: '未完成' }; yield { type: 'finish', reason: { kind: 'length' } }; };
  await assert.rejects(summarizeHandoff(ctx, a, {}, new AbortController().signal), /未完整/);
  ctx.llm.stream = async function* () { yield { type: 'text-delta', text: '未完成' }; };
  await assert.rejects(summarizeHandoff(ctx, a, {}, new AbortController().signal), /完整/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(summarizeHandoff(ctx, a, {}, controller.signal));
});
