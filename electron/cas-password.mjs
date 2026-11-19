// Optional password re-login for the BIT campus CAS.
//
// This is the only place that handles a campus password. It is used only when the
// user explicitly opted in and saved credentials; every failure path returns a
// short, sanitised reason and never includes the password, the page key or a ticket.
import { createCipheriv } from 'node:crypto';

export const CAS_ORIGIN = 'https://sso.bit.edu.cn';
export const CAS_LOGIN = `${CAS_ORIGIN}/cas/login`;

const text = (value, limit = 300) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '');

export class CasLoginError extends Error {
  constructor(code, message) {super(message);this.name = 'CasLoginError';this.code = code;}
}

function elementText(html, id) {
  const start = html.indexOf(`id="${id}"`);
  if (start === -1) return '';
  const open = html.indexOf('>', start);
  if (open === -1) return '';
  const close = html.indexOf('<', open);
  if (close === -1) return '';
  return html.slice(open + 1, close).trim();
}

function formAction(html, pageUrl) {
  const match = /<form\b[^>]*\baction\s*=\s*["']([^"']*)["']/i.exec(html);
  const action = match?.[1]?.trim() || 'login';
  try {return new URL(action, pageUrl).toString();} catch {return pageUrl;}
}

export function parseCredentialPage(html, pageUrl) {
  if (typeof html !== 'string' || !html) return null;
  const execution = elementText(html, 'login-page-flowkey');
  const pageKey = elementText(html, 'login-croypto');
  if (!execution || !pageKey) return null;
  return {execution, pageKey, formAction: formAction(html, pageUrl)};
}

export function hasSecondFactorPage(html) {
  if (typeof html !== 'string') return false;
  // The page always renders these elements; only their content says a second factor is due.
  if (!elementText(html, 'user-object-id')) return false;
  return elementText(html, 'current-login-type') === 'smsLogin'
    || !!elementText(html, 'second-auth-tip')
    || elementText(html, 'sso-second') === 'true'
    || /secondSmsLoginForm|cas-gateway/.test(html);
}

export function parseLoginError(html) {
  return text(elementText(html, 'login-error-msg'), 200);
}

export function needsCaptcha(html) {
  if (typeof html !== 'string') return false;
  // Empty placeholder elements are always present; a captcha exists only when they carry a value.
  if (elementText(html, 'captcha-url') || elementText(html, 'captchaId') || elementText(html, 'siteKey')) return true;
  return /id="captcha-img"|id="captchaImg"|<img[^>]+(?:captcha|verify)[^>]*>/i.test(html);
}

export function encryptPassword(pageKey, password) {
  if (typeof pageKey !== 'string' || !pageKey) throw new CasLoginError('unexpected_page', '登录页未提供加密参数');
  const key = Buffer.from(pageKey, 'base64');
  if (![16, 24, 32].includes(key.length)) throw new CasLoginError('unexpected_page', '登录页加密参数不可识别');
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  return Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]).toString('base64');
}

export function loginFields({username, password, page}) {
  return new URLSearchParams({
    username: String(username),
    password: encryptPassword(page.pageKey, password),
    type: 'UsernamePassword',
    _eventId: 'submit',
    execution: page.execution,
    croypto: page.pageKey,
    geolocation: '',
    captcha_code: '',
  });
}

// Single password sign-in. `request` must be the caller's Electron-jar transport
// (same session that holds the CAS cookies), so the ticket lands in the right jar.
export async function passwordSignIn({service, username, password, request, timeoutMs}) {
  const casUrl = `${CAS_LOGIN}?service=${encodeURIComponent(service || '')}`;
  const options = timeoutMs ? {timeoutMs} : undefined;
  const page = await request(casUrl, options);
  if (page.status >= 500 || page.status === 429) throw new CasLoginError('network', '统一认证服务暂时不可用');
  if (page.status >= 300 && page.status < 400) {
    if (page.location && /[?&]ticket=/.test(page.location)) return {kind: 'ticket', url: page.location};
    throw new CasLoginError('unexpected_page', '统一认证返回了无法识别的跳转');
  }
  const html = page.text || '';
  const parsed = parseCredentialPage(html, casUrl);
  if (!parsed) {
    if (hasSecondFactorPage(html)) return {kind: 'second_factor', phone: text(elementText(html, 'phone-number'), 40)};
    throw new CasLoginError('unexpected_page', '统一认证页面结构已变化，请在官方窗口登录');
  }
  if (needsCaptcha(html)) throw new CasLoginError('captcha_required', '统一认证要求图形验证码，请在官方窗口登录');
  const post = await request(parsed.formAction, {...options, method: 'POST', form: loginFields({username, password, page: parsed}).toString()});
  if (post.status === 401 || post.status === 403) throw new CasLoginError('bad_credentials', '统一认证拒绝了用户名或密码');
  if (post.status >= 500 || post.status === 429) throw new CasLoginError('network', '统一认证服务暂时不可用');
  if (post.status >= 300 && post.status < 400) {
    if (post.location && /[?&]ticket=/.test(post.location)) return {kind: 'ticket', url: post.location};
    throw new CasLoginError('login_failed', '统一认证未返回登录凭据');
  }
  const body = post.text || '';
  if (hasSecondFactorPage(body)) return {kind: 'second_factor', phone: text(elementText(body, 'phone-number'), 40)};
  if (needsCaptcha(body)) throw new CasLoginError('captcha_required', '统一认证要求图形验证码，请在官方窗口登录');
  const message = parseLoginError(body);
  if (message) throw new CasLoginError('bad_credentials', `统一认证返回：${message}`);
  if (parseCredentialPage(body, casUrl)) throw new CasLoginError('bad_credentials', '统一认证未接受这组用户名和密码');
  throw new CasLoginError('login_failed', '统一认证未完成登录');
}
