import {validSyncURL} from '../sync.mjs';
import {normalizeSyncConfig} from './config.mjs';
import {WsProvider} from './ws-provider.mjs';
import {SupabaseProvider} from './supabase-provider.mjs';
import {validateSupabaseConfig} from './supabase-config.mjs';

export class SyncController {
  constructor({getTasks, merge, status, readSession = () => null, writeSession = () => {throw new Error('系统安全存储暂不可用');}, readState = () => null, writeState = () => {}, identity = () => {}, providers = {}}) {
    this.getTasks = getTasks;
    this.merge = merge;
    this.status = status;
    Object.assign(this, {readSession, writeSession, readState, writeState, identity});
    this.providers = {ws: callbacks => new WsProvider(callbacks), supabase: callbacks => new SupabaseProvider(callbacks), ...providers};
    this.generation = 0;
    this.config = normalizeSyncConfig();
    this.active = null;
  }

  validateConfig(config, credentials = {}) {
    const next = normalizeSyncConfig(config);
    if (!next.enabled) return next;
    if (typeof this.providers[next.provider] !== 'function') throw new Error('Supabase Cloud 暂未接入');
    if (next.provider === 'ws') {
      if (!next.ws.url || typeof credentials.syncToken !== 'string' || credentials.syncToken.length < 32) throw new Error('请输入有效地址以及至少 32 字符的密钥');
      next.ws.url = validSyncURL(next.ws.url);
    } else next.supabase = validateSupabaseConfig(next.supabase);
    return next;
  }

  configure(config, credentials = {}) {
    // Reject unavailable providers before closing a working connection.
    const next = this.validateConfig(config, credentials);
    this.close();
    this.config = next;
    if (!next.enabled) return;
    const generation = this.generation;
    const current = () => generation === this.generation;
    const callbacks = {
      getTasks: () => current() ? this.getTasks() : [],
      merge: incoming => current() ? this.merge(incoming) : undefined,
      status: value => {if (current()) this.status(value);},
      readSession: () => current() ? this.readSession() : null,
      writeSession: value => {if (current()) return this.writeSession(value);},
      readState: () => current() ? this.readState() : null,
      writeState: value => {if (current()) return this.writeState(value);},
      identity: value => {if (current()) this.identity(value);}
    };
    try {
      this.active = this.providers[next.provider](callbacks);
      this.active.configure(next, credentials);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  push() {this.active?.push();}
  supabaseOperation(action, input) {
    if (this.config.provider !== 'supabase' || !this.active?.operation) throw new Error('请先启用 Supabase Cloud');
    return this.active.operation(action, input);
  }
  close() {
    this.generation++;
    const previous = this.active;
    this.active = null;
    this.config = {...this.config, enabled: false};
    previous?.close();
    this.identity(null);
    this.status('仅本机');
  }
  disable() {this.close();}
}
