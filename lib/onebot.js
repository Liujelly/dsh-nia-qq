import { randomUUID } from 'node:crypto';

export function localWS(value) {
  const u = new URL(value);
  if (u.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) throw new Error('地址必须是本机 ws:// 地址，不含令牌或查询参数');
  return u;
}

// OneBot v11 universal WebSocket: event stream and echo-correlated actions.
export class OneBot {
  constructor({ url, token, onEvent = () => {}, onReady = async () => {}, onState = () => {}, WebSocketImpl = globalThis.WebSocket }) {
    this.url = localWS(url); this.token = token; this.onEvent = onEvent; this.onReady = onReady; this.onState = onState;
    this.WebSocketImpl = WebSocketImpl; this.pending = new Map(); this.stopped = true; this.delay = 1000;
  }
  start() { this.stopped = false; this.connect(); }
  connect() {
    if (this.stopped) return;
    const u = new URL(this.url); if (this.token) u.searchParams.set('access_token', this.token);
    let socket;
    try { socket = new this.WebSocketImpl(u.toString()); } catch { this.onState('连接失败'); this.reconnect(); return; }
    this.socket = socket;
    const connecting = setTimeout(() => { this.onState('连接超时'); socket.close(); }, 15000);
    connecting.unref?.();
    socket.addEventListener('open', () => {
      clearTimeout(connecting);
      if (this.stopped || this.socket !== socket) return socket.close();
      this.delay = 1000; this.onState('已连接，校验账号');
      Promise.resolve(this.onReady()).catch(() => { this.onState('账号或联系人同步失败'); socket.close(); });
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket || this.stopped) return;
      let body;
      try { if (typeof event.data !== 'string' || event.data.length > 2 * 1024 * 1024) return; body = JSON.parse(event.data); } catch { return; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return;
      if (body.echo && this.pending.has(body.echo)) {
        const p = this.pending.get(body.echo); this.pending.delete(body.echo); clearTimeout(p.timer);
        if (body.status === 'ok' && body.retcode === 0) p.resolve(body.data);
        else p.reject(new Error(`${p.action} 返回失败（${Number(body.retcode) || -1}）`));
      } else if (body.post_type) {
        Promise.resolve().then(() => this.onEvent(body)).catch(() => this.onState('入站事件处理失败，请检查面板'));
      }
    });
    socket.addEventListener('error', () => { this.onState('连接错误，请检查地址、令牌与 SnowLuma'); socket.close(); });
    socket.addEventListener('close', () => {
      clearTimeout(connecting);
      if (this.socket !== socket) return;
      this.rejectPending(); this.onState('未连接'); this.reconnect();
    });
  }
  reconnect() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, this.delay);
    this.delay = Math.min(this.delay * 2, 30000); this.timer.unref?.();
  }
  call(action, params = {}) {
    if (this.stopped || this.socket?.readyState !== 1) return Promise.reject(new Error('SnowLuma 未连接'));
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(echo); reject(new Error(`${action} 超时，操作结果可能未知`)); this.socket?.close(); }, 15000);
      this.pending.set(echo, { resolve, reject, timer, action });
      try { this.socket.send(JSON.stringify({ action, params, echo })); }
      catch { clearTimeout(timer); this.pending.delete(echo); reject(new Error(`${action} 发送失败，操作结果可能未知`)); }
    });
  }
  rejectPending() {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`${p.action} 连接中断，操作结果可能未知`)); }
    this.pending.clear();
  }
  stop() { this.stopped = true; clearTimeout(this.timer); this.timer = undefined; this.rejectPending(); this.socket?.close(); }
}
