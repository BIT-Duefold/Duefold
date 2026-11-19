import WebSocket from 'ws';
export function validSyncURL(value) {
  const u = new URL(value);
  if (u.username || u.password || u.hash || u.search) throw new Error('同步地址不能包含账号、参数或片段');
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) throw new Error('公网同步地址必须使用 wss://；ws:// 仅允许本机');
  return u.toString();
}
export class SyncClient {
  constructor({getTasks, merge, status}) { this.getTasks = getTasks; this.merge = merge; this.status = status; this.generation = 0; }
  configure(config) {
    this.generation++; clearTimeout(this.timer); clearInterval(this.heartbeat); this.socket?.removeAllListeners(); this.socket?.on('error', () => {}); this.socket?.terminate();
    this.config = config; this.delay = 1000; this.authenticated = false;
    if (!config.enabled) {this.status('仅本机'); return;}
    this.connect(this.generation);
  }
  connect(generation) {
    if (generation !== this.generation) return;
    this.status('连接中');
    const ws = this.socket = new WebSocket(this.config.url, {maxPayload: 8 * 1024 * 1024, handshakeTimeout: 10000});
    let alive = true;
    ws.on('pong', () => {alive = true;});
    ws.on('open', () => {
      ws.send(JSON.stringify({type: 'auth', token: this.config.token}));
      this.heartbeat = setInterval(() => {if (!alive) {ws.terminate();return;}alive = false;ws.ping();}, 20000);this.heartbeat.unref();
    });
    let first = true;
    ws.on('message', async raw => {
      if (generation !== this.generation) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'error') {this.status('同步失败，请检查服务');return;}
        if (msg.type !== 'snapshot' || msg.protocol !== 1) throw new Error('不兼容的服务');
        await this.merge(msg.tasks); this.delay = 1000;
        if (first) {first = false;this.authenticated = true;this.push();}
        else this.status('已同步');
      } catch {this.status('同步数据无效');ws.close(1007);}
    });
    ws.on('error', () => {});
    ws.on('close', code => {
      if (generation !== this.generation) return;
      clearInterval(this.heartbeat);
      this.authenticated = false;
      if (code === 1008) {this.status('密钥无效，请检查设置');return;}
      this.status('离线，等待重连');
      this.timer = setTimeout(() => this.connect(generation), this.delay); this.delay = Math.min(this.delay * 2, 30000);
    });
  }
  push() {
    if (this.authenticated && this.socket?.readyState === WebSocket.OPEN) {
      this.status('同步中');this.socket.send(JSON.stringify({type: 'merge', tasks: this.getTasks()}));
    }
  }
  close() {this.configure({enabled: false});}
}
