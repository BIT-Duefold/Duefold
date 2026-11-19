import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { mergeTasks, validateTasks } from '../shared/model.mjs';
import { atomicWrite, readJSON } from '../shared/storage.mjs';
export async function createSyncServer({ token, file, host = '127.0.0.1', port = 8787 }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('SYNC_TOKEN 至少需要 32 个字符');
  let tasks = validateTasks(readJSON(file, []));
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(req.url === '/health' ? { ok: true, protocol: 1 } : { error: 'not found' }));
  });
  const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
  const authorized = new Set();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {if (ws.alive === false) {ws.terminate();continue;}ws.alive = false;ws.ping();}
  }, 30000);
  heartbeat.unref();
  const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  wss.on('connection', ws => {
    ws.alive = true;ws.on('pong', () => {ws.alive = true;});
    if (wss.clients.size > 100) { ws.close(1013, 'Too many clients'); return; }
    const timeout = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
    ws.on('close', () => { clearTimeout(timeout); authorized.delete(ws); });
    ws.on('error', () => {});
    ws.on('message', buffer => {
      try {
        const msg = JSON.parse(buffer.toString());
        if (!authorized.has(ws)) {
          const candidate = Buffer.from(typeof msg.token === 'string' ? msg.token : '');
          const expected = Buffer.from(token);
          if (msg.type !== 'auth' || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) { ws.close(1008, 'Invalid token'); return; }
          authorized.add(ws); clearTimeout(timeout); send(ws, { type: 'snapshot', protocol: 1, tasks }); return;
        }
        if (msg.type !== 'merge') throw new Error('Unknown message');
        const next = validateTasks(mergeTasks(tasks, msg.tasks));
        atomicWrite(file, next); tasks = next;
        // Broadcast only after successful disk persistence, including acknowledgement to sender.
        for (const peer of authorized) send(peer, { type: 'snapshot', protocol: 1, tasks });
      } catch { send(ws, { type: 'error', message: '同步数据无效或保存失败' }); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { port: server.address().port, tasks: () => tasks, close: () => new Promise(resolve => {
    clearInterval(heartbeat);for (const ws of wss.clients) ws.terminate(); wss.close(() => server.close(resolve));
  }) };
}
