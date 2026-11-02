import test from 'node:test';
import assert from 'node:assert/strict';
import { Sessions } from '../lib/sessions.js';

function fixture(enabled = true) {
  const hooks = new Map(); let removed = 0;
  const agent = { session: { id: 'qq', header: {} }, ctx: {
    on(name, fn) { assert.equal(name, 'agent/pre-step'); hooks.set(agent, fn); return () => { removed++; hooks.delete(agent); }; },
    tools: { register: () => () => {} }, systemPrompt: { section: () => () => {} },
  } };
  const sessions = new Sessions({}, {}, () => ({ ttsEnabled: enabled }));
  const chat = { account: '1', type: 'private', id: '2' };
  return { agent, sessions, chat, hooks, removed: () => removed };
}
const signal = () => new AbortController().signal;

test('one reset per mounted TTS agent, never another agent or every turn', async () => {
  const a = fixture(), b = fixture(), disabled = fixture(false);
  a.sessions.mount(a.agent, a.chat, {}); a.sessions.mount(a.agent, a.chat, {});
  b.sessions.mount(b.agent, b.chat, {}); disabled.sessions.mount(disabled.agent, disabled.chat, {});
  assert.equal(a.hooks.size, 1); assert.equal(disabled.hooks.size, 0);
  const hook = a.hooks.get(a.agent), enter = { kind: 'enter', messages: [{ id: 'history' }], startsRequestSeries: false, other: 42 };
  assert.strictEqual(await hook({ agent: b.agent, signal: signal() }, () => enter), enter);
  const result = await hook({ agent: a.agent, signal: signal() }, () => enter);
  assert.deepEqual(result, { ...enter, startsRequestSeries: true }); assert.equal(enter.startsRequestSeries, false);
  assert.strictEqual(await hook({ agent: a.agent, signal: signal() }, () => enter), enter);
  assert.equal((await b.hooks.get(b.agent)({ agent: b.agent, signal: signal() }, () => enter)).startsRequestSeries, true);
  await a.sessions.close(); await b.sessions.close(); await disabled.sessions.close(); assert.equal(a.removed(), 1);
});

test('failure, rejection, abort, and disposal do not consume or alter the decision', async () => {
  const f = fixture(); f.sessions.mount(f.agent, f.chat, {}); const hook = f.hooks.get(f.agent);
  const err = new Error('next failed'); await assert.rejects(hook({ agent: f.agent, signal: signal() }, () => { throw err; }), e => e === err);
  await assert.rejects(hook({ agent: f.agent, signal: signal() }, async () => { throw err; }), e => e === err);
  const reject = { kind: 'reject' }; assert.strictEqual(await hook({ agent: f.agent, signal: signal() }, () => reject), reject);
  const enter = { kind: 'enter', messages: [] }, controller = new AbortController();
  assert.strictEqual(await hook({ agent: f.agent, signal: controller.signal }, () => { controller.abort(); return enter; }), enter);
  assert.equal((await hook({ agent: f.agent, signal: signal() }, () => enter)).startsRequestSeries, true);
  await f.sessions.close();
  const g = fixture(); g.sessions.mount(g.agent, g.chat, {}); const pendingHook = g.hooks.get(g.agent); let resolve;
  const pending = pendingHook({ agent: g.agent, signal: signal() }, () => new Promise(r => { resolve = r; }));
  await g.sessions.close(); resolve(enter); assert.strictEqual(await pending, enter); assert.equal(g.removed(), 1);
});

test('mount failure unregisters hook and later mount retries', async () => {
  const f = fixture(); const register = f.agent.ctx.systemPrompt.section;
  f.agent.ctx.systemPrompt.section = () => { throw new Error('mount failed'); };
  assert.throws(() => f.sessions.mount(f.agent, f.chat, {}), /mount failed/);
  assert.equal(f.hooks.size, 0); assert.equal(f.removed(), 1);
  f.agent.ctx.systemPrompt.section = register; f.sessions.mount(f.agent, f.chat, {}); assert.equal(f.hooks.size, 1);
  await f.sessions.close(); assert.equal(f.removed(), 2);
});
