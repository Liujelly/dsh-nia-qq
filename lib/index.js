import { sessionCatalog } from './catalog.js';
import { agentModel } from './model.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store, atomicJSON, readJSON, qqId } from './store.js';
import { OneBot, localWS } from './onebot.js';
import { Sessions } from './sessions.js';
import { Bridge } from './bridge.js';
import { Media } from './media.js';
import { AsrInstaller } from './asr-installer.js';

export const name = 'nia-qq';
export const inject = ['agents', 'sessions', 'sessionPersistence', 'sessionTitle', 'systemPrompt', 'tools', 'webServer', 'workspaceRegistry', 'attachments', 'llm'];
export const defaults = { enabled: false, dryRun: true, cooperate: false, personaId: 'nia', characterName: '角色', ownerQQ: '', wsUrl: 'ws://127.0.0.1:3001/', token: '', account: '', provider: '', model: '', preset: '', workspace: '', personaFile: '', batchMs: 3000, maxBatchMs: 12000,
  batchMode:'adaptive',interruptPolicy:'related',maxReplyYields:2,splitReplies:true,replyIntervalMs:450,groupScope:'all',replyGate:true,
  receiveImages:true,sendImages:true,imageLimit:4,imageMaxMB:5,imageRoot:'',
  asrEnabled:false,asrExecutable:'',asrArgs:'["{file}"]',asrTimeoutSec:60,ffmpegExecutable:'',
  historyRecovery:true,historyMinutes:10,autoForward:false,onlyQQWake:true,onlyMarked:false,autoContinue:true };

export function validateConfig(input, previous = defaults) {
  const next = { ...previous };
  for (const k of ['enabled', 'dryRun', 'cooperate','splitReplies','replyGate','receiveImages','sendImages','asrEnabled','historyRecovery','autoForward','onlyQQWake','onlyMarked','autoContinue']) if (k in input) {
    if (typeof input[k] !== 'boolean') throw new Error(`${k} 必须是布尔值`); next[k] = input[k];
  }
  for (const k of ['wsUrl', 'account', 'provider', 'model', 'preset', 'workspace', 'personaFile', 'personaId', 'ownerQQ', 'characterName','imageRoot','asrExecutable','asrArgs','ffmpegExecutable']) if (k in input) {
    if (typeof input[k] !== 'string' || input[k].length > 4096) throw new Error(`${k} 格式错误`); next[k] = input[k].trim();
  }
  if ('token' in input && input.token !== '') {
    if (typeof input.token !== 'string' || input.token.length > 4096) throw new Error('令牌格式错误'); next.token = input.token;
  }
  if (input.clearToken === true) next.token = '';
  if ('batchMs' in input) {
    if (!Number.isInteger(input.batchMs) || input.batchMs < 0 || input.batchMs > 60000) throw new Error('合并窗口范围为 0–60000 毫秒'); next.batchMs = input.batchMs;
  }
  if ('maxBatchMs' in input) {
    if (!Number.isInteger(input.maxBatchMs) || input.maxBatchMs < 1000 || input.maxBatchMs > 300000) throw new Error('最长合并等待范围为 1000–300000 毫秒'); next.maxBatchMs = input.maxBatchMs;
  }
  if (next.maxBatchMs < next.batchMs) throw new Error('最长合并等待不能小于停顿等待');
  for(const [k,values]of Object.entries({batchMode:['adaptive','sender','chat'],interruptPolicy:['related','all'],groupScope:['all','directed']}))if(k in input){if(!values.includes(input[k]))throw Error(k+' 选项无效');next[k]=input[k];}
  for(const [k,min,max]of [['maxReplyYields',0,5],['replyIntervalMs',0,5000],['imageLimit',1,10],['imageMaxMB',1,30],['asrTimeoutSec',5,300],['historyMinutes',1,1440]])if(k in input){if(!Number.isInteger(input[k])||input[k]<min||input[k]>max)throw Error(`${k} 范围 ${min}–${max}`);next[k]=input[k];}
  const args=JSON.parse(next.asrArgs||'[]');if(!Array.isArray(args)||args.length>40||args.some(x=>typeof x!=='string'))throw Error('转写参数须为字符串数组 JSON');
  if(next.asrEnabled&&(!next.asrExecutable||!args.some(x=>x.includes('{file}'))))throw Error('语音转写需要程序路径和含 {file} 的参数');
  if(next.imageRoot&&(!path.isAbsolute(next.imageRoot)||!fs.statSync(next.imageRoot).isDirectory()))throw Error('图片根目录必须是已存在的绝对目录');
  localWS(next.wsUrl);
  if (next.account) qqId(next.account);
  if (next.ownerQQ) qqId(next.ownerQQ);
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(next.personaId)) throw new Error('人格标识无效');
  if (!next.characterName || next.characterName.length > 60 || /[\x00-\x1f]/.test(next.characterName)) throw new Error('角色名应为 1–60 个可见字符');
  if (next.workspace && (!path.isAbsolute(next.workspace) || !fs.statSync(next.workspace).isDirectory())) throw new Error('工作目录必须是已存在的绝对路径');
  if (next.personaFile && (!path.isAbsolute(next.personaFile) || !fs.statSync(next.personaFile).isFile())) throw new Error('人格文件必须是已存在的绝对路径');
  if (next.enabled && (!next.workspace || !next.model || !next.provider || !next.account)) throw new Error('启用前请设置 QQ 账号、工作目录、模型提供方和模型');
  return next;
}

function json(res, status, body) {
  res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body));
}
async function requestBody(req) {
  if (req.headers['x-nia-qq'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) throw new Error('请求缺少设置页标记');
  if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new Error('拒绝跨站修改');
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 65536) throw new Error('设置请求过大'); }
  const parsed = JSON.parse(body || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求应为 JSON 对象');
  return parsed;
}

export function apply(ctx, { createInstaller = options => new AsrInstaller(options) } = {}) {
  const directory = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'nia-qq');
  const configFile = path.join(directory, 'config.json');
  let cfg = { ...defaults, ...readJSON(configFile, {}) };
  // Parsing errors fail plugin activation instead of resetting contacts/history.
  localWS(cfg.wsUrl);
  const store = new Store(path.join(directory, 'state.json'));
  let bridge, api, interval, syncInterval, disposed = false, change = Promise.resolve();
  let status = '未启用', error = '', historyError = '', continuationError = '', syncBusy = false;
  let activityPolicy;
  const facade={activityConfig:()=>({account:cfg.account,ownerQQ:cfg.ownerQQ,workspace:cfg.workspace,provider:cfg.provider,model:cfg.model,preset:cfg.preset,personaId:cfg.personaId,characterName:cfg.characterName,personaFile:cfg.personaFile,preview:!!cfg.dryRun}),
    registerActivityPolicy:fn=>{activityPolicy=fn;if(bridge)bridge.activityPolicy=fn;},unregisterActivityPolicy:fn=>{if(activityPolicy===fn){activityPolicy=undefined;if(bridge)bridge.activityPolicy=undefined;}},
    recentActivityAt:()=>Math.max(0,...store.data.inbox.filter(x=>x.chat?.startsWith(cfg.account+':')).map(x=>Number(x.at)||0)),
    activityContact:args=>{if(!bridge)throw Error('QQ 接入未运行');return bridge.cooperation.activityContact(args);},
    activityGroups:()=>Object.values(store.data.chats).filter(c=>c.account===cfg.account&&c.type==='group'&&c.active&&!c.paused&&!c.activityContactsPaused).map(c=>({groupId:c.id,name:c.name||c.id})),
    activityGroupContact:args=>{if(!bridge)throw Error('QQ 接入未运行');return bridge.cooperation.groupContact(null,args);}};
  const provide=ctx.provide?.bind(ctx)||ctx.reflect?.provide?.bind(ctx.reflect);if(provide)provide('niaQQ',facade);
  const report = (text, kind) => { if(kind==='history')historyError=text;else if(kind==='continuation')continuationError=text;else error = text; };
  const safeError = e => String(e?.message || '操作失败').replaceAll(cfg.token || '\u0000', '[已隐藏令牌]').slice(0, 300);
  async function stop() {
    clearInterval(interval); clearInterval(syncInterval);
    api?.stop();
    const old = bridge; bridge = undefined; api = undefined;
    await old?.stop(); status = '未启用'; historyError = '';
  }
  async function restart() {
    await stop();
    if (!cfg.enabled || disposed) return;
    validateConfig(cfg, cfg);
    if (typeof globalThis.WebSocket !== 'function') throw new Error('当前 DSH Node 运行时缺少 WebSocket；需要 Node 22 或更新版本');
    const sessions = new Sessions(ctx, store, () => cfg);
    await sessions.prepareWorkspace();
    const transport = new OneBot({ url: cfg.wsUrl, token: cfg.token,
      onState: text => { status = text; if (['未连接', '连接错误，请检查地址、令牌与 SnowLuma'].includes(text) && bridge) bridge.ready = false; },
      onReady: async () => { try { await instance.connect(); status = '已连接'; error = ''; } catch (e) { report(safeError(e)); throw e; } },
      onEvent: event => { try { instance.event(event); } catch (e) { report(safeError(e)); } } });
    const media=new Media({directory:path.join(directory,'media'),api:transport,config:()=>cfg,attachments:sessions.get('attachments')});
    const instance = new Bridge({ store, api: transport, sessions, config: () => cfg, media, report });
    instance.activityPolicy=activityPolicy;
    api = transport; bridge = instance; transport.start();
    interval = setInterval(() => instance.tick(), 500); interval.unref?.();
    syncInterval = setInterval(async () => {
      if (!instance.ready || syncBusy) return;
      syncBusy = true;
      try { await instance.sync(); await instance.recover(); } catch { report('联系人同步失败，将在下次连接或定时同步时重试'); } finally { syncBusy = false; }
    }, 60000); syncInterval.unref?.();
  }
  function serialize(task) {
    const next = change.then(task); change = next.catch(() => {}); return next;
  }
  const installer = createInstaller({root:path.join(directory,'asr'),configure:(fields,signal)=>serialize(async()=>{
    signal.throwIfAborted();if(disposed)throw Error('插件正在关闭');
    const next=validateConfig(fields,cfg);atomicJSON(configFile,next);cfg=next;
  })});
  ctx.effect(() => async () => { disposed = true; await installer.close(); return serialize(stop); });
  if(ctx.on)ctx.effect(()=>ctx.on('session/event',(session,event)=>{try{bridge?.sessionEvent(session,event);}catch{report('自动转发处理失败，请检查操作记录');}}));
  function route(suffix, method, handler) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/dsh-nia-qq/' + suffix,
      handler: async (req, res) => {
        if (req.method !== method) return json(res, 405, { ok: false, error: '请求方法不支持' });
        try { json(res, 200, { ok: true, ...(await handler(method === 'POST' ? await requestBody(req) : {})) }); }
        catch (e) { json(res, 400, { ok: false, error: safeError(e) }); }
      } }));
  }
  route('state', 'GET', async () => {
    const { token, ...publicConfig } = cfg;
    return { config: publicConfig, tokenSet: Boolean(token), status, error:[error,historyError,continuationError].filter(Boolean).join('\n'),
      chats: Object.values(store.data.chats).map(c=>({...c,temporaryPeer:c.type==='private'&&!store.data.people[`${c.account}:${c.id}`]?.friend})),
      queue: store.data.inbox.filter(x => x.status !== 'delivered').map(({ key, chat, status, at }) => ({ key, chat, status, at })),
      actions: Object.values(store.data.actions).slice(-60), intents: Object.values(store.data.intents).slice(-100),
      templates: (await sessionCatalog(ctx)).filter(a => a.live && !String(a.id).startsWith('nia-qq-')) };
  });
  route('config', 'POST', input => serialize(async () => {
    if(installer.snapshot().running)throw Error('语音依赖安装中；请完成或取消安装后再保存设置。');
    const next = validateConfig(input, cfg);
    await stop(); cfg = next; atomicJSON(configFile, cfg); await restart(); return {};
  }));
  route('asr', 'GET', () => ({asr:installer.snapshot()}));
  route('asr-install', 'POST', input => serialize(async()=>{
    if(input.action==='start')return {asr:installer.start()};
    if(input.action==='cancel')return {asr:installer.cancel()};
    throw Error('安装操作无效');
  }));
  route('template', 'POST', input => serialize(async () => {
    const agent = ctx.agents.get(String(input.sessionId));
    if (!agent) throw new Error('请先在 DSH 打开角色的模板会话');
    const model = agentModel(ctx,agent); if (!model) throw new Error('模板会话尚未选择模型');
    const preset = (ctx.get?.('agentPresets') ?? ctx.agentPresets)?.composedPreset(agent.ctx) || '';
    const workspace = cfg.workspace || agent.session.header.cwd;
    return { template: { provider: model.provider, model: model.model, preset, workspace }, copied: '已填入模型、预设与工作目录，请保存设置' };
  }));
  route('chat', 'POST', input => {
    const c = store.data.chats[String(input.key)]; if (!c) throw new Error('聊天不存在');
    if (typeof input.paused !== 'boolean') throw new Error('暂停状态错误');
    c.paused = input.paused; store.save(); return {};
  });
  route('continuation', 'POST', input => {
    const c = store.data.chats[String(input.key)];
    if (!bridge || !c || c.account !== bridge.account) throw Error('请先连接对应 QQ 账号');
    return { continuation: bridge.continuation.control(c, input.action) };
  });
  route('activity-chat', 'POST', input => {
    const c=store.data.chats[String(input.key)];if(!c||c.type!=='private'||typeof input.paused!=='boolean')throw Error('私聊或暂停状态无效');
    c.activityContactsPaused=input.paused;store.save();return {};
  });
  route('action-review', 'POST', input => {
    const entry = store.data.actions[String(input.key)];
    if (!entry || entry.status !== 'uncertain') throw Error('只能标记结果未知的操作');
    entry.continuationReviewedAt = Date.now(); store.save();
    return { status: entry.status, instruction: '仅解除续接等待；不代表发送成功，也不会重试操作' };
  });
  route('queue', 'POST', input => {
    const item = store.data.inbox.find(x => x.key === input.key); if (!item) throw new Error('消息不存在');
    if (input.action === 'retry' && item.status === 'failed') item.status = 'pending';
    else if (input.action === 'discard' && ['pending', 'failed', 'uncertain'].includes(item.status)) item.status = 'discarded';
    else throw new Error('只能重试尚未投递的失败消息；结果未知需先核查 DSH 记录，可将其标记忽略');
    store.save(); return {};
  });
  route('intent', 'POST', input => {
    const item = store.data.intents[input.id]; if (!item) throw new Error('联系意图不存在');
    if (input.action === 'retry' && item.status === 'failed') item.status = 'pending';
    else if (input.action === 'discard' && ['pending', 'failed', 'uncertain'].includes(item.status)) item.status = 'discarded';
    else throw new Error('不能重放结果未知或已经处理的联系');
    store.save(); return {};
  });
  // Queue startup so route registration completes first; report without leaking backend credentials.
  void serialize(restart).catch(e => report(safeError(e)));
}
