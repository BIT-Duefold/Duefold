import {SupabaseError} from './supabase-rpc.mjs';

const invalid = () => {throw new SupabaseError('设备操作参数不正确', {kind: 'request'});};
const badData = () => {throw new SupabaseError('设备数据无效，请刷新后重试', {kind: 'data'});};
const id = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const date = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));

// These are the only operations reachable from the renderer. Never accept an
// arbitrary RPC name, token, session or owner supplied by the renderer.
export function deviceOperation(action, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  if (action === 'join' || action === 'request') {
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
    const deviceName = typeof input.deviceName === 'string' ? input.deviceName.trim() : '';
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new SupabaseError('用户名须为 3–20 位小写字母、数字或下划线', {kind: 'request'});
    if (!deviceName || !text(deviceName, 80)) throw new SupabaseError('设备名须为 1–80 个字符', {kind: 'request'});
    const body = {p_username: username, p_device_name: deviceName};
    if (action === 'request') return {rpc: 'request_device', body};
    const code = typeof input.code === 'string' ? input.code.replace(/[\s-]/g, '') : '';
    if (!/^[a-f0-9]{16}$/i.test(code)) throw new SupabaseError('请输入 16 位邀请码或恢复码', {kind: 'request'});
    return {rpc: 'redeem_invite', body: {...body, p_code: code}};
  }
  if (action === 'approve' || action === 'deny') {
    if (!id(input.requestId)) invalid();
    if (action === 'deny') return {rpc: 'deny_device', body: {p_request_id: input.requestId}};
    if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new SupabaseError('请输入新设备屏幕上的 6 位确认码', {kind: 'request'});
    return {rpc: 'approve_device', body: {p_request_id: input.requestId, p_code: input.code}};
  }
  if (action === 'revoke') {
    if (!id(input.deviceId)) invalid();
    return {rpc: 'revoke_device', body: {p_device_id: input.deviceId}};
  }
  if (action === 'devices') return {rpc: 'list_devices', body: {}};
  if (action === 'pending') return {rpc: 'pending_device_requests', body: {}};
  if (action === 'refresh') return {rpc: null, body: {}};
  invalid();
}

// Project every response before it crosses IPC; extra server fields (including
// an accidental confirmation code in an approval list) never reach the UI.
export function deviceResult(action, data, sessionUserId) {
  if (action === 'refresh') return null;
  if (!data || typeof data !== 'object') badData();
  if (action === 'join') {
    if (!id(data.owner_id) || data.device_id !== sessionUserId || typeof data.username !== 'string' || !/^[a-z0-9_]{3,20}$/.test(data.username) || !['join', 'recover'].includes(data.kind)) badData();
    return {username: data.username, kind: data.kind};
  }
  if (action === 'request') {
    if (!id(data.request_id) || !id(data.owner_id) || typeof data.code !== 'string' || !/^\d{6}$/.test(data.code) || typeof data.owner_username !== 'string' || !/^[a-z0-9_]{3,20}$/.test(data.owner_username) || !text(data.device_name, 80) || !date(data.expires_at)) badData();
    return {requestId: data.request_id, code: data.code, username: data.owner_username, deviceName: data.device_name, expiresAt: data.expires_at};
  }
  if (action === 'devices') {
    if (!id(data.owner_id) || !Array.isArray(data.devices) || data.devices.length > 1000) badData();
    return data.devices.map(row => {
      if (!row || !id(row.device_id) || !text(row.name, 80) || !['active', 'revoked'].includes(row.status) || !date(row.created_at) || !(row.last_seen === null || date(row.last_seen)) || typeof row.is_current !== 'boolean') badData();
      return {deviceId: row.device_id, name: row.name, status: row.status, createdAt: row.created_at, lastSeen: row.last_seen, isCurrent: row.device_id === sessionUserId};
    });
  }
  if (action === 'pending') {
    if (!id(data.owner_id) || !Array.isArray(data.requests) || data.requests.length > 1000) badData();
    return data.requests.map(row => {
      if (!row || !id(row.request_id) || !text(row.device_name, 80) || !date(row.created_at) || !date(row.expires_at)) badData();
      return {requestId: row.request_id, deviceName: row.device_name, createdAt: row.created_at, expiresAt: row.expires_at};
    });
  }
  if (action === 'approve') {if (!id(data.owner_id) || !id(data.device_id)) badData();}
  if (action === 'deny') {if (!id(data.request_id) || data.status !== 'denied') badData();}
  if (action === 'revoke') {if (!id(data.device_id) || data.status !== 'revoked') badData();}
  return null;
}
