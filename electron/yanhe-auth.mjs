import { createHash } from 'node:crypto';

export const YANHE_ORIGIN = 'https://aita.yanhekt.cn';
export const YANHE_PROFILE = `${YANHE_ORIGIN}/userapi/v1/infosimple`;
export const YANHE_LANDING = `${YANHE_ORIGIN}/course`;
const forward = encodeURIComponent(YANHE_LANDING);
export const YANHE_ENTRY = `${YANHE_ORIGIN}/casapi/index.php?r=auth/login&auType=&tenant_code=21&forward=${forward}`;
export const YANHE_CAS = `${YANHE_ORIGIN}/casapi/index.php?forward=${forward}&r=auth/login&auType=cas&tenant_code=21`;
const CAS_LOGIN = 'https://sso.bit.edu.cn/cas/login';
const MIN_VALID_MS = 5000;
const messages = {
  none: '尚未登录，请在官方窗口完成认证。', checking: '正在核验延河登录状态…',
  signed_in: '延河已确认登录。此状态仅代表 aita，不代表课后任务站点已登录或所有作业已读取。',
  expired: '延河登录已过期，正在尝试复用统一认证会话。', renewing: '正在使用已有北理工统一认证会话恢复登录…',
  verification_required: '会话已失效或统一认证需要验证，请点击“重新登录”完成密码、验证码或短信验证。已有待办已保留。',
  network: '暂时无法连接认证服务；未清除本机连接数据。可打开官方登录窗口重试，已有待办保留。',
  service_error: '认证服务返回了无法确认的响应；未清除本机连接数据，请稍后重新检查。',
  account_mismatch: '当前登录账号与已连接账号不一致，已暂停读取。请断开后重新连接以切换账号。',
  unsafe_redirect: '认证跳转不符合预期，已停止恢复。请从官方登录入口重新登录。'
};
export function tokenFromCookie(value) {
  if (typeof value !== 'string' || value.length > 32768) return null;
  let decoded = value;try {decoded = decodeURIComponent(value);} catch {}
  return decoded.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0] || null;
}
export function tokenClaims(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
    const account = ['string', 'number'].includes(typeof payload.account) ? String(payload.account).trim() : '';
    if (!account || account.length > 100 || !Number.isFinite(payload.exp) || payload.exp <= 0 || payload.exp * 1000 > 8.64e15) return null;
    return {account, expiresAt: payload.exp * 1000};
  } catch {return null;}
}
export function isYanheTokenCookie(cookie) {
  const domain = typeof cookie?.domain === 'string' ? cookie.domain.replace(/^\./, '').toLowerCase() : '';
  return cookie?.name === '_token' && (domain === 'yanhekt.cn' || domain === 'aita.yanhekt.cn');
}
const fingerprint = jwt => createHash('sha256').update(jwt).digest('hex');
function authURL(value) {
  let u;try {u = new URL(value);} catch {throw new Error('unsafe_redirect');}
  if (u.username || u.password || u.hash || u.protocol !== 'https:') throw new Error('unsafe_redirect');
  return u;
}
function serviceURL(value) {
  const u = authURL(value);
  if (u.origin !== YANHE_ORIGIN || u.pathname !== '/casapi/index.php' || u.searchParams.get('r') !== 'auth/login' || u.searchParams.get('auType') !== 'cas' || u.searchParams.get('tenant_code') !== '21') throw new Error('unsafe_redirect');
  if ([...u.searchParams.keys()].some(k => !['r', 'auType', 'tenant_code', 'forward'].includes(k)) || [...u.searchParams.keys()].some(k => u.searchParams.getAll(k).length !== 1)) throw new Error('unsafe_redirect');
  const landing = authURL(u.searchParams.get('forward'));
  if (landing.origin !== YANHE_ORIGIN) throw new Error('unsafe_redirect');
  return u;
}
function ticketURL(value, service) {
  const u = authURL(value);const copy = new URL(u);
  if (!copy.searchParams.get('ticket') || copy.searchParams.getAll('ticket').length !== 1) throw new Error('unsafe_redirect');
  copy.searchParams.delete('ticket');
  const base = serviceURL(copy.toString());const expected = serviceURL(service);
  if (base.origin !== expected.origin || base.pathname !== expected.pathname || [...expected.searchParams].some(([k,v]) => base.searchParams.get(k) !== v)) throw new Error('unsafe_redirect');
  return u.toString();
}
function isRedirect(reply) {return reply.status >= 300 && reply.status < 400;}
function location(reply, base) {return reply.location ? new URL(reply.location, base).toString() : '';}

// The transport owns Electron's cookie jar. This class never logs HTTP bodies, tokens or URLs containing tickets.
export class YanheSession {
  constructor({request, cookies, clearToken, read, write, onState, now = Date.now, credential = null, passwordSignIn = null, onPasswordFailure = null, onPasswordChallenge = null}) {
    Object.assign(this, {request, cookies, clearToken, read, write, onState, now, credential, passwordSignIn, onPasswordFailure, onPasswordChallenge});
    this.state = {state: 'none', message: messages.none};this.nextRecoveryAt = 0;this.disposed = false;this.passwordAttempts = 0;
  }
  emit(state, expiresAt = null, message = null) {
    if (this.disposed) return this.state;
    this.state = {state, message: message || messages[state], checkedAt: new Date(this.now()).toISOString(), expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? new Date(expiresAt).toISOString() : null};
    this.onState(this.state);return this.state;
  }
  check({recover = true, force = false} = {}) {
    if (this.disposed) return Promise.resolve(this.state);
    if (this.pending) return this.pending;
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort.abort(), 45000);timeout.unref?.();
    this.pending = this.run({recover, force}).catch(error => {
      if (this.disposed) return this.state;
      return this.emit(error?.message === 'unsafe_redirect' ? 'unsafe_redirect' : 'network');
    }).finally(() => {clearTimeout(timeout);this.pending = null;});
    return this.pending;
  }
  async send(url, headers = {}) {
    if (this.disposed || this.abort.signal.aborted) throw new Error('cancelled');
    const result = await this.request(url, {headers, signal: this.abort.signal});
    if (this.disposed || this.abort.signal.aborted) throw new Error('cancelled');return result;
  }
  async candidates() {
    const saved = this.read();
    const rejected = new Set(saved.rejected || []);
    const raw = (await this.cookies()).filter(isYanheTokenCookie).map(c => tokenFromCookie(c.value));
    if (saved.jwt) raw.push(saved.jwt);
    return [...new Set(raw.filter(Boolean))].map(jwt => ({jwt, claims: tokenClaims(jwt)})).filter(t => t.claims && !rejected.has(fingerprint(t.jwt)));
  }
  async validate(jwt, claims) {
    const expected = this.read().account;
    if (expected && expected !== claims.account) return this.emit('account_mismatch');
    this.emit('checking', claims.expiresAt);
    const reply = await this.send(YANHE_PROFILE, {Authorization: `Bearer ${jwt}`, Accept: 'application/json', 'tenant-id': '21'});
    if ([401,403].includes(reply.status) || [401,403].includes(reply.body?.code)) return {rejected: true};
    if (reply.status < 200 || reply.status >= 300) return this.emit(reply.status >= 500 || reply.status === 429 ? 'network' : 'service_error', claims.expiresAt);
    const body = reply.body;
    if (!body || body.code !== 200 || !body.params || typeof body.params !== 'object') return this.emit('service_error', claims.expiresAt);
    const p = body.params;
    if (!Number.isInteger(Number(p.id)) || Number(p.id) <= 0 || !Number.isInteger(Number(p.tenant_id)) || Number(p.tenant_id) <= 0) return this.emit('service_error', claims.expiresAt);
    if (p.account != null && String(p.account) !== claims.account) return this.emit('account_mismatch');
    if (claims.expiresAt <= this.now() + MIN_VALID_MS) return {rejected: true};
    this.write({...this.read(), jwt, account: claims.account, expiresAt: claims.expiresAt});
    this.nextRecoveryAt = 0;return this.emit('signed_in', claims.expiresAt);
  }
  async invalidate(candidate) {
    if (this.disposed) return;
    const saved = this.read();
    const rejected = [...new Set([...(saved.rejected || []), fingerprint(candidate.jwt)])].slice(-16);
    this.write({...saved, jwt: '', expiresAt: 0, rejected});
    await this.clearToken(candidate.jwt);
  }
  async run({recover, force}) {
    const candidates = await this.candidates();
    if (this.disposed) return this.state;
    const candidate = candidates.find(c => c.claims.expiresAt > this.now() + MIN_VALID_MS) || candidates[0];
    if (candidate && this.read().account && candidate.claims.account !== this.read().account) return this.emit('account_mismatch');
    if (candidate?.claims.expiresAt > this.now() + MIN_VALID_MS) {
      const checked = await this.validate(candidate.jwt, candidate.claims);
      if (!checked.rejected) return checked;
      await this.invalidate(candidate);
    } else if (candidate) await this.invalidate(candidate);
    const remembered = this.read().account || candidate || this.read().rejected?.length;
    if (!remembered && !force) return this.emit('none');
    if (!recover) return this.emit(remembered ? 'expired' : 'none');
    if (!force && this.now() < this.nextRecoveryAt) return this.emit(['network','service_error','unsafe_redirect'].includes(this.state.state) ? this.state.state : 'verification_required');
    this.emit('renewing');this.nextRecoveryAt = this.now() + 10 * 60 * 1000;
    return this.renew();
  }
  async renew() {
    // Seat PHPSESSID before discovering the exact service string. No Bearer on CAS requests.
    const entry = await this.send(YANHE_ENTRY);
    if (entry.status >= 500 || entry.status === 429) return this.emit('network');
    const discovery = await this.send(YANHE_CAS);
    if (discovery.status >= 500 || discovery.status === 429) return this.emit('network');
    if (!isRedirect(discovery) || !discovery.location) return this.emit('service_error');
    const login = authURL(location(discovery, YANHE_CAS));
    if (!['https://login.bit.edu.cn', 'https://sso.bit.edu.cn'].includes(login.origin) || !['/authserver/login', '/cas/login'].includes(login.pathname)) throw new Error('unsafe_redirect');
    const service = login.searchParams.get('service');serviceURL(service);
    const casURL = `${CAS_LOGIN}?service=${encodeURIComponent(service)}`;
    const cas = await this.send(casURL);
    if (cas.status >= 500 || cas.status === 429) return this.emit('network');
    if (isRedirect(cas) && cas.location) return this.followTicket(location(cas, casURL), service);
    if (cas.status !== 200) return this.emit('service_error');
    return this.tryPasswordLogin(service);
  }
  // Explicit opt-in only: the caller injects credentials and the sign-in transport.
  async tryPasswordLogin(service) {
    const credential = typeof this.credential === 'function' ? this.credential() : null;
    if (!this.passwordSignIn || !credential || !credential.enabled || !credential.username || !credential.password) return this.emit('verification_required');
    if (this.passwordAttempts >= 2) return this.emit('verification_required', null, '保存的密码连续无法登录，已暂停本次尝试；请检查或更新已保存的密码，或在官方窗口登录。');
    this.passwordAttempts++;
    this.emit('renewing');
    try {
      const result = await this.passwordSignIn({service, username: credential.username, password: credential.password});
      if (result?.kind === 'second_factor') {try {await this.onPasswordChallenge?.('second_factor');} catch {} return this.emit('verification_required', null, '统一认证要求短信验证，请在官方窗口完成本次登录；验证码不会被自动提交。');}
      if (result?.kind === 'ticket' && result.url) {this.passwordAttempts = 0;return this.followTicket(result.url, service);}
      return this.emit('verification_required');
    } catch (error) {
      this.passwordAttempts = 0;
      if (error?.code === 'bad_credentials') {try {await this.onPasswordFailure?.(error);} catch {} return this.emit('verification_required', null, '已保存的用户名或密码无法登录，请在官方窗口重新登录，并更新“自动重新登录”中的密码。');}
      if (error?.code === 'captcha_required') {try {await this.onPasswordChallenge?.('captcha');} catch {} return this.emit('verification_required', null, '统一认证要求图形验证码，请在官方窗口完成登录。');}
      if (error?.code === 'network') return this.emit('network');
      return this.emit('verification_required');
    }
  }
  async followTicket(start, service) {
    let next = ticketURL(start, service);
    for (let i = 0; i < 4; i++) {
      const reply = await this.send(next);
      if (reply.status >= 500 || reply.status === 429) return this.emit('network');
      const candidate = (await this.candidates()).find(c => c.claims.expiresAt > this.now() + MIN_VALID_MS);
      if (candidate) {
        const checked = await this.validate(candidate.jwt, candidate.claims);
        if (!checked.rejected) return checked;
        await this.invalidate(candidate);return this.emit('verification_required');
      }
      if (!isRedirect(reply) || !reply.location) break;
      const redirected = authURL(location(reply, next));
      if (redirected.origin === YANHE_ORIGIN && redirected.pathname === '/course') break;
      // Only the ticket callback or the exact service callback can be followed.
      next = redirected.searchParams.has('ticket') ? ticketURL(redirected.toString(), service) : serviceURL(redirected.toString()).toString();
      const cmp = new URL(next);cmp.searchParams.delete('ticket');
      if ([...new URL(service).searchParams].some(([k,v]) => cmp.searchParams.get(k) !== v)) throw new Error('unsafe_redirect');
    }
    return this.emit('verification_required');
  }
  dispose() {this.disposed = true;this.abort?.abort();return this.pending || Promise.resolve();}
}
