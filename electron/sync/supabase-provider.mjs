import {validateTasks} from '../../shared/model.mjs';
import {SupabaseAuth} from './supabase-auth.mjs';
import {SupabaseRPC, SupabaseError, checkActive} from './supabase-rpc.mjs';
import {deviceOperation, deviceResult} from './supabase-devices.mjs';

export class SupabaseProvider {
  constructor({getTasks, merge, status, readSession, writeSession, readState = () => null, writeState = () => {}, identity = () => {}, fetch: fetcher, now = Date.now, pollInterval = 12000, heartbeatInterval = 60000, debounce = 300, timeout = 15000}) {
    Object.assign(this, {getTasks, merge, status, readSession, writeSession, readState, writeState, identity, fetch: fetcher, now, pollInterval, heartbeatInterval, debounce, timeout});
    this.context = null;this.idle = Promise.resolve();
  }
  configure(config) {
    this.close();
    if (!config.enabled) return;
    const context = this.context = {
      config: config.supabase, abort: new AbortController(), busy: false, terminal: false,
      revision: this.getTasks().length ? 1 : 0, acknowledged: 0, owner: null, cursor: null,
      initialized: false, lastHeartbeat: this.now(), delay: 1000, retryAt: 0, timer: null,
      commands: [], executing: null, pendingRequest: null
    };
    context.auth = new SupabaseAuth({config: context.config, readSession: this.readSession, writeSession: this.writeSession, fetch: this.fetch, signal: context.abort.signal, now: this.now, timeout: this.timeout,
      onError: error => {if (this.current(context)) this.failure(context, error);}});
    context.rpc = new SupabaseRPC({config: context.config, auth: context.auth, fetch: this.fetch, signal: context.abort.signal, timeout: this.timeout});
    this.status('连接中');this.run(context);
  }
  current(context) {return this.context === context && !context.abort.signal.aborted && !context.terminal;}
  check(context) {checkActive(context.abort.signal);if (!this.current(context)) throw new DOMException('操作已停止', 'AbortError');}
  schedule(context, delay) {
    if (!this.current(context)) return;
    clearTimeout(context.timer);
    context.timer = setTimeout(() => {context.timer = null;this.run(context);}, delay);
    context.timer.unref?.();
  }
  run(context) {
    if (!this.current(context) || context.busy) return this.idle;
    if (context.retryAt > this.now()) {this.schedule(context, context.retryAt - this.now());return this.idle;}
    clearTimeout(context.timer);context.timer = null;context.busy = true;
    this.idle = (async () => {
      try {
        await this.commands(context);this.check(context);
        await this.cycle(context);this.check(context);
        context.delay = 1000;context.retryAt = 0;
        const waiting = context.pendingRequest && Date.parse(context.pendingRequest.expiresAt) > this.now();
        this.schedule(context, context.commands.length ? 0 : context.owner && context.revision > context.acknowledged ? this.debounce : waiting ? 3000 : this.pollInterval);
      } catch (error) {
        if (this.current(context)) this.failure(context, error);
      } finally {
        context.busy = false;
        if (context.commands.length && this.current(context) && !context.retryAt) this.schedule(context, 0);
      }
    })();
    return this.idle;
  }
  async cycle(context) {
    const session = await context.auth.ensureSession();this.check(context);
    const identity = await context.rpc.call('whoami');this.check(context);
    if (!identity || identity.device_id !== session.user_id || !(identity.owner_id === null || typeof identity.owner_id === 'string' && identity.owner_id.length > 0)) throw new SupabaseError('同步数据无效', {kind: 'data'});
    if (!context.initialized) {
      const saved = await this.readState();this.check(context);
      if (!context.enrolling && saved?.projectUrl === context.config.url && saved.userId === session.user_id) {
        context.owner = saved.ownerId;
        if (saved.ownerId === identity.owner_id && this.getTasks().length && typeof saved.lastServerTime === 'string' && Number.isFinite(Date.parse(saved.lastServerTime))) context.cursor = saved.lastServerTime;
      }
      context.initialized = true;
    }
    if (identity.owner_id) context.pendingRequest = null;
    context.publicIdentity = {deviceId: identity.device_id, ownerId: identity.owner_id,
      username: typeof identity.username === 'string' && /^[a-z0-9_]{3,20}$/.test(identity.username) ? identity.username : null,
      deviceName: typeof identity.device_name === 'string' ? identity.device_name.slice(0, 80) : null,
      deviceCount: Number.isSafeInteger(identity.device_count) && identity.device_count >= 0 ? identity.device_count : 0,
      pendingRequests: Number.isSafeInteger(identity.pending_requests) && identity.pending_requests >= 0 ? identity.pending_requests : 0,
      pendingDeviceRequest: context.pendingRequest};
    this.identity({...context.publicIdentity, retryAt: 0});
    if (!identity.owner_id) {
      if (context.owner) throw new SupabaseError('设备已被撤销', {kind: 'revoked'});
      this.status(context.pendingRequest && Date.parse(context.pendingRequest.expiresAt) > this.now() ? '等待批准' : '等待加入');return;
    }
    if (context.owner !== identity.owner_id) {context.cursor = null;context.owner = identity.owner_id;}
    this.status('同步中');
    const pulled = await context.rpc.call('pull_tasks', {p_since: context.cursor});this.check(context);
    const pulledTasks = this.snapshot(pulled);
    await this.merge(pulledTasks);this.check(context);
    let serverTime = pulled.server_time;
    if (context.revision > context.acknowledged) {
      const revision = context.revision, outgoing = validateTasks(this.getTasks());
      const merged = await context.rpc.call('merge_tasks', {p_tasks: outgoing});this.check(context);
      await this.merge(this.snapshot(merged));this.check(context);
      serverTime = merged.server_time;context.acknowledged = revision;
    }
    // Never advance the durable cursor until all corresponding tasks are on disk.
    await this.writeState({projectUrl: context.config.url, userId: session.user_id, ownerId: context.owner, lastServerTime: serverTime});this.check(context);
    context.cursor = serverTime;
    if (this.now() - context.lastHeartbeat >= this.heartbeatInterval) {
      const heartbeat = await context.rpc.call('heartbeat');this.check(context);
      if (heartbeat?.ok === false && heartbeat.reason === '设备未授权') throw new SupabaseError('设备已被撤销', {kind: 'revoked'});
      if (heartbeat?.ok !== true) throw new SupabaseError('同步数据无效', {kind: 'data'});
      context.lastHeartbeat = this.now();
    }
    this.status(context.revision > context.acknowledged ? '同步中' : '已同步');
  }
  snapshot(data) {
    if (!data || typeof data.server_time !== 'string' || !Number.isFinite(Date.parse(data.server_time))) throw new SupabaseError('同步数据无效', {kind: 'data'});
    try {return validateTasks(data.tasks);} catch {throw new SupabaseError('同步数据无效', {kind: 'data'});}
  }
  failure(context, error) {
    if (!this.current(context)) return;
    this.rejectCommands(context, error);
    if (error?.kind === 'retry') {
      const delay = Math.max(context.delay, error.retryAfter || 0);
      context.retryAt = this.now() + delay;context.delay = Math.min(context.delay * 2, 30000);
      this.identity({...context.publicIdentity, retryAt: context.retryAt});
      this.status(error.status === 429 || error.retryAfter ? '请求过于频繁，请稍后再试' : '离线，等待重连');
      this.schedule(context, delay);
    } else {
      context.terminal = true;context.terminalKind = error?.kind;clearTimeout(context.timer);context.auth.close();context.abort.abort();
      if (error?.kind === 'revoked') this.identity(null);
      this.status(error instanceof SupabaseError ? error.message : '同步失败，请检查服务');
    }
  }
  push() {
    const context = this.context;
    if (!context || !this.current(context)) return;
    context.revision++;
    if (!context.busy) this.schedule(context, Math.max(this.debounce, context.retryAt - this.now()));
  }
  operation(action, input) {
    const operation = deviceOperation(action, input);
    let context = this.context;
    // An explicit enrollment action can reattach a revoked device using its
    // existing anonymous identity. Never silently create a replacement user.
    if (context?.terminalKind === 'revoked' && ['join', 'request'].includes(action)) {
      this.configure({enabled: true, supabase: context.config});
      context = this.context;context.enrolling = true;
    }
    if (!context || !this.current(context)) return Promise.reject(new SupabaseError('请先启用或重新连接 Supabase Cloud', {kind: 'request'}));
    if (context.retryAt > this.now()) return Promise.reject(new SupabaseError('请稍后重试，正在等待重新连接', {kind: 'request'}));
    if (context.commands.length >= 8) return Promise.reject(new SupabaseError('请等待当前操作完成', {kind: 'request'}));
    return new Promise((resolve, reject) => {
      context.commands.push({action, operation, resolve, reject});
      if (!context.busy) this.run(context);
    });
  }
  async commands(context) {
    while (context.commands.length) {
      const command = context.executing = context.commands.shift();
      try {
        const session = await context.auth.ensureSession();this.check(context);
        const data = command.operation.rpc ? await context.rpc.call(command.operation.rpc, command.operation.body) : null;
        this.check(context);
        const result = deviceResult(command.action, data, session.user_id);
        if (command.action === 'request') context.pendingRequest = result;
        command.resolve(result);
      } catch (error) {
        command.reject(error);
        if (['retry', 'session', 'revoked', 'storage'].includes(error?.kind)) throw error;
      } finally {context.executing = null;}
    }
  }
  rejectCommands(context, error) {
    context.executing?.reject(error);
    for (const command of context.commands.splice(0)) command.reject(error);
  }
  close() {
    const context = this.context;this.context = null;
    if (context) {
      this.rejectCommands(context, new SupabaseError('同步设置已更改，操作已停止', {kind: 'request'}));
      clearTimeout(context.timer);context.abort.abort();context.auth.close();
    }
    this.status('仅本机');
  }
}
