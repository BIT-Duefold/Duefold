const rpcNames = new Set(['whoami', 'redeem_invite', 'request_device', 'approve_device', 'deny_device', 'revoke_device', 'list_devices', 'pending_device_requests', 'merge_tasks', 'pull_tasks', 'heartbeat']);

export class SupabaseError extends Error {
  constructor(message, {status = 0, kind = 'service', retryAfter = 0} = {}) {
    super(message);this.name = 'SupabaseError';this.status = status;this.kind = kind;this.retryAfter = retryAfter;
  }
}

// Never forward arbitrary server text: auth errors can contain credentials or URLs.
export function rpcError(status, message, retryAfter = 0) {
  if (typeof message !== 'string') message = '';
  if (message.includes('设备未授权')) return new SupabaseError('设备已被撤销', {status, kind: 'revoked'});
  if (status === 401) return new SupabaseError('登录已失效', {status, kind: 'session'});
  if (status === 429 || /(?:请求|尝试)过于频繁/.test(message)) return new SupabaseError('请求过于频繁，请稍后再试', {status, kind: 'retry', retryAfter});
  if (status >= 500) return new SupabaseError('离线，等待重连', {status, kind: 'retry'});
  const known = [
    ['邀请码无效或已过期', '邀请码无效或已过期，请联系管理员重新生成'],
    ['用户名不存在', '用户名不存在，请检查拼写'],
    ['4 台设备上限', '该账号已达到 4 台设备上限，请先撤销一台旧设备'],
    ['确认码不正确', '确认码不正确，请核对新设备显示的六位码'],
    ['请求已失效', '请求已失效，请让新设备重新发起'],
    ['请求不存在', '请求不存在，请刷新后重试'],
    ['用户名已被占用', '用户名已被占用'],
    ['此设备已注册', '此设备已注册'],
    ['此设备已加入某个账号', '此设备已加入某个账号'],
    ['已有其他账号的待处理请求', '已有其他账号的待处理请求，请等待请求失效'],
    ['至少保留一台活跃设备', '至少保留一台活跃设备；如全部丢失请联系管理员恢复'],
    ['设备不存在或已撤销', '设备不存在或已撤销']
  ];
  const match = known.find(([part]) => message.includes(part));
  // PostgREST can map SQL class 28 (e.g. invalid invitation/confirmation)
  // to HTTP 403. A known business rejection must not revoke the provider.
  if (!match && status === 403) return new SupabaseError('设备已被撤销', {status, kind: 'revoked'});
  return new SupabaseError(match?.[1] ?? '同步失败，请检查服务', {status, kind: 'request'});
}

export function checkActive(signal) {
  if (signal?.aborted) throw new DOMException('操作已停止', 'AbortError');
}

export async function requestJSON({fetch: fetcher = globalThis.fetch, url, key, path, body, accessToken, signal, timeout = 15000}) {
  checkActive(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(abort, timeout);timer.unref?.();
  try {
    const response = await fetcher(`${url}${path}`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: {apikey: key, 'Content-Type': 'application/json', ...(accessToken ? {Authorization: `Bearer ${accessToken}`} : {})},
      body: JSON.stringify(body)
    });
    checkActive(signal);
    let data;
    try {data = await response.json();} catch {
      if (!response.ok) throw rpcError(response.status, '');
      throw new SupabaseError('同步数据无效', {kind: 'data'});
    }
    checkActive(signal);
    if (!response.ok) {
      const retryHeader = response.headers?.get?.('retry-after');
      const retryAfter = /^\d+$/.test(retryHeader ?? '') ? Math.min(3600000, Number(retryHeader) * 1000) : 0;
      throw rpcError(response.status, data?.message ?? data?.msg ?? data?.error_description, retryAfter);
    }
    return data;
  } catch (error) {
    checkActive(signal);
    if (error instanceof SupabaseError) throw error;
    throw new SupabaseError('离线，等待重连', {kind: 'retry'});
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort', abort);
  }
}

export class SupabaseRPC {
  constructor({config, auth, fetch: fetcher, signal, timeout}) {
    this.config = config;this.auth = auth;this.fetch = fetcher;this.signal = signal;this.timeout = timeout;
  }
  async call(name, body = {}) {
    if (!rpcNames.has(name)) throw new SupabaseError('不支持的云端操作', {kind: 'request'});
    let session = await this.auth.ensureSession();
    const request = () => requestJSON({fetch: this.fetch, url: this.config.url, key: this.config.publishableKey, path: `/rest/v1/rpc/${name}`, body, accessToken: session.access_token, signal: this.signal, timeout: this.timeout});
    try {return await request();} catch (error) {
      if (error.status !== 401) throw error;
      session = await this.auth.refresh(session.access_token);
      return request(); // One refresh and one retry, never a recursion.
    }
  }
}
