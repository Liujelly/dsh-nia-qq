import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function atomicJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error; }
}

export function qqId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('QQ ID 超出安全整数范围');
  const id = String(value ?? '');
  if (!/^[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('QQ ID 无效');
  return id;
}

export function chatKey(account, type, id) {
  if (!['private', 'group'].includes(type)) throw new Error('会话类型无效');
  return `${qqId(account)}:${type}:${qqId(id)}`;
}

export class Store {
  constructor(file) {
    this.file = file;
    this.data = readJSON(file, { version: 2, chats: {}, people: {}, inbox: [], seen: [], actions: {} });
    const d = this.data;
    if (![1, 2].includes(d.version) || !d.chats || !d.people || !Array.isArray(d.inbox) || !Array.isArray(d.seen) || !d.actions) throw new Error('QQ 接入数据格式无效；保留原文件，拒绝覆盖');
    if (d.version === 1) {
      fs.copyFileSync(file, file + '.v1.bak');
      for (const c of Object.values(d.chats)) if (c.created) c.legacySessionId = c.sessionId;
      d.version = 2;
    }
    for (const item of d.inbox) if (item.status === 'delivering') item.status = 'uncertain';
    for (const item of Object.values(d.actions)) if (item.status === 'sending') item.status = 'uncertain';
    d.intents ??= {};
    if (typeof d.intents !== 'object' || Array.isArray(d.intents)) throw new Error('联系队列格式损坏');
    for (const item of Object.values(d.intents)) if (['delivering', 'accepted'].includes(item.status)) item.status = 'uncertain';
    this.save();
  }
  save() { atomicJSON(this.file, this.data); }
  person(account, id, name, friend) {
    const key = `${qqId(account)}:${qqId(id)}`;
    const p = this.data.people[key] ??= { account: qqId(account), id: qqId(id), name: '', alias: '', friend: false };
    if (name) p.name = String(name).slice(0, 120);
    if (friend !== undefined) p.friend = friend;
    return p;
  }
  chat(account, type, id, name) {
    const key = chatKey(account, type, id);
    const c = this.data.chats[key] ??= { key, account: qqId(account), type, id: qqId(id), name: '', sessionId: 'nia-qq-' + randomUUID(), created: false, active: true, paused: false, members: [], discoveredAt: Date.now() };
    if (name) c.name = String(name).slice(0, 120);
    return c;
  }
  enqueue(chat, event) {
    const messageId = String(event.message_id ?? '');
    if (!/^-?\d+$/.test(messageId)) throw new Error('入站消息缺少可去重的 message_id');
    const key = `${chat.key}:${messageId}`;
    if (this.data.seen.includes(key)) return false;
    if (this.data.inbox.filter(x => !['delivered', 'discarded'].includes(x.status)).length >= 500) throw new Error('待处理消息达到 500 条，请检查面板');
    this.data.inbox.push({ key, chat: chat.key, id: randomUUID(), event, status: 'pending', at: Date.now() });
    this.data.seen.push(key);
    this.data.seen = this.data.seen.slice(-10000);
    const done = this.data.inbox.filter(x => ['delivered', 'discarded'].includes(x.status)).slice(-300);
    this.data.inbox = [...done, ...this.data.inbox.filter(x => !['delivered', 'discarded'].includes(x.status))];
    this.save(); return true;
  }
}
