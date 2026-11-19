import path from 'node:path';
import { createSyncServer } from './service.mjs';
const host = process.env.SYNC_HOST || '127.0.0.1';
const service = await createSyncServer({ token: process.env.SYNC_TOKEN, host, port: Number(process.env.SYNC_PORT || 8787),
  file: path.resolve(process.env.SYNC_DATA || '.runtime/sync/tasks.json') });
console.log(`归序同步服务 http://${host}:${service.port} · 公网请使用 WSS 反向代理`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); process.exit(0); });
