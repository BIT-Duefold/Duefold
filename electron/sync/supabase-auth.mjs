import {SupabaseError, requestJSON, checkActive} from './supabase-rpc.mjs';

export class SupabaseAuth {
  constructor({config, readSession = () => null, writeSession, fetch: fetcher, signal, now = Date.now, onError = () => {}, timeout}) {
    this.config = config;this.readSession = readSession;this.writeSession = writeSession;this.fetch = fetcher;this.signal = signal;this.now = now;this.onError = onError;this.timeout = timeout;
    this.pending = null;this.timer = null;this.session = null;this.loaded = false;this.closed = false;this.refreshNeeded = false;
  }
  check() {checkActive(this.signal);if (this.closed) throw new DOMException('操作已停止', 'AbortError');}
  async load() {
    if (this.loaded) return;
    const saved = await this.readSession();this.check();
    if (saved) {
      if (saved.projectUrl !== this.config.url) throw new SupabaseError('云端项目与已保存的登录不一致，请使用原项目', {kind: 'session'});
      if (typeof saved.access_token !== 'string' || !saved.access_token || typeof saved.refresh_token !== 'string' || !saved.refresh_token || typeof saved.user_id !== 'string' || !Number.isFinite(saved.expires_at)) throw new SupabaseError('登录已失效', {kind: 'session'});
      this.session = saved;
    }
    this.loaded = true;
  }
  async ensureSession() {
    this.check();await this.load();
    if (this.pending) return this.pending;
    if (!this.session) return this.exchange(false);
    if (this.refreshNeeded || this.session.expires_at * 1000 - this.now() <= 60000) return this.refresh();
    this.schedule();return this.session;
  }
  async refresh(rejectedToken) {
    this.check();await this.load();
    if (this.pending) return this.pending;
    if (!this.session) throw new SupabaseError('登录已失效', {kind: 'session'});
    // Another caller may already have rotated the rejected access token.
    if (rejectedToken && this.session.access_token !== rejectedToken) return this.session;
    return this.exchange(true);
  }
  exchange(refresh) {
    if (this.pending) return this.pending;
    clearTimeout(this.timer);
    this.pending = (async () => {
      try {
        const data = await requestJSON({fetch: this.fetch, url: this.config.url, key: this.config.publishableKey,
          path: refresh ? '/auth/v1/token?grant_type=refresh_token' : '/auth/v1/signup',
          body: refresh ? {refresh_token: this.session.refresh_token} : {data: {}, gotrue_meta_security: {}}, signal: this.signal, timeout: this.timeout});
        this.check();
        const expiresAt = Number.isFinite(data?.expires_at) ? data.expires_at : Math.floor(this.now() / 1000) + data?.expires_in;
        if (typeof data?.access_token !== 'string' || !data.access_token || typeof data?.refresh_token !== 'string' || !data.refresh_token || typeof data?.user?.id !== 'string' || !data.user.id || !Number.isFinite(expiresAt) || expiresAt * 1000 <= this.now()) throw new SupabaseError('登录响应无效', {kind: 'session'});
        if (refresh && data.user.id !== this.session.user_id) throw new SupabaseError('登录身份不一致，请重新加入', {kind: 'session'});
        const session = {projectUrl: this.config.url, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt, user_id: data.user.id};
        try {await this.writeSession(session);} catch {this.check();throw new SupabaseError('无法安全保存云端登录，请检查系统安全存储', {kind: 'storage'});}
        this.check();this.session = session;this.refreshNeeded = false;this.schedule();return session;
      } catch (error) {
        this.check();
        if (refresh) this.refreshNeeded = true;
        if (refresh && error.status >= 400 && error.status < 500 && error.status !== 429) throw new SupabaseError('登录已失效', {kind: 'session', status: error.status});
        if (!refresh && error.status >= 400 && error.status < 500 && error.status !== 429) throw new SupabaseError('无法匿名登录，请检查云端配置', {kind: 'request', status: error.status});
        throw error;
      }
    })().finally(() => {this.pending = null;});
    return this.pending;
  }
  schedule() {
    clearTimeout(this.timer);
    if (!this.session || this.closed) return;
    const delay = Math.max(1000, Math.min(2147483647, this.session.expires_at * 1000 - this.now() - 60000));
    this.timer = setTimeout(() => {this.timer = null;void this.refresh().catch(error => {if (!this.closed && !this.signal?.aborted) this.onError(error);});}, delay);
    this.timer.unref?.();
  }
  close() {this.closed = true;clearTimeout(this.timer);}
}
