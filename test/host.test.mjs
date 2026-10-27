import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { apply, defaults } from '../lib/index.js';
import { OneBot, localWS } from '../lib/onebot.js';
import { AsrInstaller } from '../lib/asr-installer.js';

test('host routes register; credentials remain write-only; cross-site config requests rejected', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nia-host-test-'));
  const original = process.env.DSH_HOME; process.env.DSH_HOME = dir;
  fs.mkdirSync(path.join(dir,'nia-qq'),{recursive:true});
  fs.writeFileSync(path.join(dir,'nia-qq/state.json'),JSON.stringify({version:2,chats:{},people:{},inbox:[],seen:[],actions:{'test-unknown':{key:'test-unknown',status:'uncertain'}}}));
  const effects = [], routes = new Map();
  const ctx = { agents: { list: () => [], get: () => undefined }, effect: f => { const off = f(); effects.push(off); return off; },
    webServer: { register: r => { routes.set(r.path, r.handler); return () => routes.delete(r.path); } } };
  t.after(async () => {
    for (const off of effects.reverse()) await off?.();
    if (original === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = original;
    assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('nia-host-test-')); fs.rmSync(dir, { recursive: true });
  });
  let installer,finishInstall;
  apply(ctx,{createInstaller:options=>(installer=new AsrInstaller({...options,probe:async()=>['python',[]],execute:async()=>new Promise(resolve=>{finishInstall=resolve;})}))});
  async function req(route, method, body, headers = {}) {
    const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    request.method = method; request.headers = { host: '127.0.0.1:3000', 'x-nia-qq': '1', 'content-type': 'application/json', ...headers };
    let response;
    const res = { setHeader() {}, end(text) { response = JSON.parse(text); } };
    await routes.get('/dsh-nia-qq/' + route)(request, res); return { body: response, status: res.statusCode };
  }
  assert.equal(routes.size, 11);
  assert.equal((await req('activity-chat','POST',{key:'missing',paused:true})).status,400);
  assert.equal((await req('action-review','POST',{key:'missing'})).status,400);
  assert.equal((await req('action-review','POST',{key:'missing'},{origin:'https://evil.example'})).status,400);
  assert.equal((await req('action-review','POST',{key:'test-unknown'})).body.status,'uncertain');
  const reviewed=(await req('state','GET')).body.actions.find(x=>x.key==='test-unknown');
  assert.equal(reviewed.status,'uncertain');assert.ok(reviewed.continuationReviewedAt);
  assert.equal((await req('asr','GET')).body.asr.status,'idle');
  assert.equal((await req('asr-install','POST',{action:'start'},{origin:'https://evil.example'})).status,400);
  assert.equal((await req('asr-install','POST',{action:'unknown'})).status,400);
  assert.equal((await req('asr-install','GET')).status,405);
  assert.equal((await req('config', 'POST', { token: 'test-secret-only' })).status, 200);
  const state = (await req('state', 'GET')).body;
  assert.equal(state.tokenSet, true); assert.equal(JSON.stringify(state).includes('test-secret-only'), false);
  assert.equal((await req('config', 'POST', { dryRun: false }, { origin: 'https://evil.example' })).status, 400);
  assert.equal((await req('config', 'GET')).status, 405);
  assert.equal((await req('config', 'POST', { enabled: true })).status, 400);
  assert.equal((await req('state', 'GET')).body.config.enabled, false);
  ctx.agents.get = id => ({session:{header:{cwd:dir},requestHeader:()=>({config:{provider:'test-provider',model:'test-model'}})},ctx:{}});
  const before=(await req('state','GET')).body.config;
  const template=(await req('template','POST',{sessionId:'sample'})).body.template;
  assert.equal(template.provider,'test-provider');
  assert.deepEqual((await req('state','GET')).body.config,before,'template reads must not save/reconnect');
  assert.equal((await req('asr-install','POST',{action:'start'})).body.asr.running,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await req('config','POST',{characterName:'改名'})).status,400,'settings cannot overwrite auto-configuration mid-install');
  finishInstall({asrExecutable:'test-python',asrArgs:'["{file}"]',ffmpegExecutable:'test-ffmpeg'});await installer.job;
  const after=(await req('state','GET')).body;
  assert.deepEqual(after.config,{...before,asrExecutable:'test-python',asrArgs:'["{file}"]',ffmpegExecutable:'test-ffmpeg'});
  assert.equal(after.config.asrEnabled,false);assert.equal(after.tokenSet,true);
});

class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.events = new Map(); this.sent = []; FakeSocket.instances.push(this); }
  addEventListener(name, callback) { const a = this.events.get(name) || []; a.push(callback); this.events.set(name, a); }
  emit(name, event = {}) { for (const fn of this.events.get(name) || []) fn(event); }
  send(text) { this.sent.push(JSON.parse(text)); }
  open() { this.readyState = 1; this.emit('open'); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
}
test('WebSocket echo routing, authentication, event dispatch and uncertain disconnect', async t => {
  const events = [], states = [];
  const api = new OneBot({ url: 'ws://127.0.0.1:3001/', token: 'private', WebSocketImpl: FakeSocket, onEvent: e => events.push(e), onState: s => states.push(s) });
  t.after(() => api.stop()); api.start(); const s = FakeSocket.instances.at(-1); s.open();
  assert.equal(new URL(s.url).searchParams.get('access_token'), 'private');
  const call = api.call('get_status'); const echo = s.sent.at(-1).echo;
  s.emit('message', { data: JSON.stringify({ echo, status: 'ok', retcode: 0, data: { online: true } }) });
  assert.deepEqual(await call, { online: true });
  s.emit('message', { data: 'null' });
  s.emit('message', { data: JSON.stringify({ post_type: 'notice', notice_type: 'friend_add' }) }); await Promise.resolve(); assert.equal(events.length, 1);
  const unknown = api.call('send_private_msg'); const rejection = assert.rejects(unknown, /结果可能未知/); s.close(); await rejection;
  assert.equal(states.some(x => x.includes('private')), false); assert.equal(api.pending.size, 0);
});
test('connection validates local endpoint and rejects credentials in URLs', () => {
  for (const url of ['https://127.0.0.1/', 'ws://127.0.0.1/?access_token=x', 'ws://user:pass@localhost/', 'ws://example.com/']) assert.throws(() => localWS(url));
});
test('settings client renders form, chat controls and preview output with escaped React text', async () => {
  const state = [], effects = []; let index = 0, component, module;
  const data = { ok: true, config: defaults, tokenSet: false, status: '未启用', error: '', templates: [],
    chats: [{ key: '100:private:200', type: 'private', id: '200', name: '<script>bad</script>', active: true, sessionId: 's1' }],
    queue: [{ key: 'event1', chat: '100:private:200', status: 'failed' }], actions: [{ key: 'action1', at: 1, action: 'send_private_msg', status: 'preview', params: { text: '你好' } }] };
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
    useEffect: callback => effects.push(callback) };
  const context = { window: { __ModuleLoader__: { load: def => { module = def.factory(() => React); } } },
    fetch: async url => ({ ok: true, json: async () => String(url).endsWith('/asr') ? {ok:true,asr:{status:'idle',stage:'idle',running:false}} : data }), console, Date, JSON, setTimeout:()=>0,clearTimeout:()=>{} };
  vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), context);
  const slots = { inject: (_name, f) => f(), register: (_meta, render) => { component = render().type; } }; module.apply({ slots });
  component(); for (const effect of effects.splice(0)) effect(); await new Promise(resolve => setImmediate(resolve));
  index = 0; const tree = component();
  const serialized = JSON.stringify(tree); assert.match(serialized, /保存设置并重连/); assert.match(serialized, /操作记录/);
  const flatten=n=>n&&typeof n==='object'?[n,...(n.children||[]).flat(Infinity).flatMap(flatten)]:[];
  flatten(tree).find(n=>n.props?.role==='tab'&&n.children.includes('聊天')).props.onClick();index=0;
  assert.match(JSON.stringify(component()), /<script>bad<\/script>/);
  assert.equal(serialized.includes('dangerouslySetInnerHTML'), false);
});
