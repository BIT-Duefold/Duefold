import {validSyncURL} from '../sync.mjs';
import {SUPABASE_DEFAULTS, validateSupabaseConfig} from './supabase-config.mjs';

const providers = ['ws', 'supabase'];

// Persist only configuration fields. Credentials belong to the encrypted vault.
export function normalizeSyncConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('同步设置格式不正确');
  const provider = value.provider ?? 'ws';
  if (!providers.includes(provider)) throw new Error('未知同步服务');
  const cloud = value.supabase;
  const useDefaults = !cloud || (!cloud.url && !cloud.publishableKey);
  return {
    provider,
    enabled: value.enabled === true,
    ws: {url: typeof value.ws?.url === 'string' ? value.ws.url : typeof value.url === 'string' ? value.url : ''},
    supabase: {
      url: useDefaults ? SUPABASE_DEFAULTS.url : typeof cloud.url === 'string' ? cloud.url : '',
      publishableKey: useDefaults ? SUPABASE_DEFAULTS.publishableKey : typeof cloud.publishableKey === 'string' ? cloud.publishableKey : ''
    }
  };
}

export function prepareSyncConfiguration(input, current, storedToken = '') {
  if (!input || typeof input.enabled !== 'boolean' || (input.token !== undefined && typeof input.token !== 'string')) throw new Error('同步设置格式不正确');
  const previous = normalizeSyncConfig(current);
  const provider = input.provider ?? 'ws';
  if (!providers.includes(provider)) throw new Error('未知同步服务');
  const config = {...previous, provider, enabled: input.enabled};
  let token = storedToken;
  if (provider === 'ws') {
    const url = input.ws?.url ?? input.url;
    if (typeof url !== 'string') throw new Error('同步设置格式不正确');
    config.ws = {url: url.trim() ? validSyncURL(url.trim()) : ''};
    token = input.token || storedToken;
    if (config.enabled && (!config.ws.url || typeof token !== 'string' || token.length < 32)) throw new Error('请输入有效地址以及至少 32 字符的密钥');
  } else {
    const source = input.supabase ?? previous.supabase;
    config.supabase = validateSupabaseConfig(source, config.enabled);
  }
  return {config, token};
}

export function syncSettings(config, secrets, identity = null) {
  const safe = normalizeSyncConfig(config);
  const pending = identity?.pendingDeviceRequest;
  return {
    provider: safe.provider,
    enabled: safe.enabled,
    ws: safe.ws,
    supabase: safe.supabase,
    url: safe.ws.url, // Compatibility with the existing WebSocket dialog.
    hasToken: !!secrets.syncToken,
    hasSupabaseSession: !!secrets.supabaseSession && secrets.supabaseSession.projectUrl === safe.supabase.url,
    supabaseUsername: identity?.username ?? null,
    supabaseDeviceCount: identity?.deviceCount ?? 0,
    supabasePendingRequests: identity?.pendingRequests ?? 0,
    supabaseRetryAt: Number.isSafeInteger(identity?.retryAt) ? identity.retryAt : 0,
    supabaseDeviceName: identity?.deviceName ?? null,
    supabasePendingDeviceRequest: pending ? {requestId: pending.requestId, code: pending.code, username: pending.username, deviceName: pending.deviceName, expiresAt: pending.expiresAt} : null
  };
}
