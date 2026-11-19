import type { Bridge, Snapshot } from './types';
import {PREVIEW_STORAGE_KEY as key, loadPreview} from '../shared/preview-storage.mjs';
const initial: Snapshot = {tasks: [], device: crypto.randomUUID(), connections: {}, settings: {provider: 'ws', url: '', enabled: false, hasToken: false, ws: {url: ''}, supabase: {url: '', publishableKey: ''}, hasSupabaseSession: false, supabaseUsername: null}, syncStatus: '仅本机'};
let preview: Snapshot = initial;
if (!window.duefold) {try {preview = loadPreview(localStorage, initial);} catch {preview = initial;}}
if (!window.duefold) {
  const settings = preview.settings;
  const url = settings.ws?.url ?? settings.url ?? '';
  preview = {...preview, settings: {...initial.settings, ...settings, provider: settings.provider ?? 'ws', url, ws: {url}, supabase: settings.supabase ?? initial.settings.supabase}};
}
export const desktop = !!window.duefold;
export const bridge: Bridge = window.duefold || {
  load: async () => preview,
  saveTasks: async tasks => { preview = {...preview, tasks}; localStorage.setItem(key, JSON.stringify(preview)); },
  setTheme: async themeMode => {if(!['system','light','dark'].includes(themeMode))throw new Error('外观模式无效');preview={...preview,themeMode};localStorage.setItem(key,JSON.stringify(preview));},
  login: async () => { throw new Error('平台登录请在 Windows 桌面版中使用'); },
  checkSession: async () => { throw new Error('登录检查请在 Windows 桌面版中使用'); },
  credentialStatus: async () => ({saved: false, username: null, auto: false, failures: 0}),
  saveCredential: async () => { throw new Error('保存统一认证账号请在 Windows 桌面版中使用'); },
  clearCredential: async () => ({saved: false, username: null, auto: false, failures: 0}),
  configureCourses: async () => { throw new Error('课程选择请在 Windows 桌面版中设置'); },
  scan: async () => { throw new Error('自动读取请在 Windows 桌面版中使用'); },
  disconnect: async () => {},
  readImport: async () => null,
  exportData: async text => { const url = URL.createObjectURL(new Blob([text], {type: 'application/json'})); const a = document.createElement('a'); a.href = url; a.download = '归序-待办备份.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return true; },
  configureSync: async () => { throw new Error('实时同步请在桌面版设置；浏览器页面仅用于界面预览'); },
  joinSupabase: async () => {throw new Error('云端加入请用桌面版');},
  requestSupabaseDevice: async () => {throw new Error('申请设备请用桌面版');},
  approveSupabaseDevice: async () => {throw new Error('批准设备请用桌面版');},
  denySupabaseDevice: async () => {throw new Error('拒绝申请请用桌面版');},
  listSupabaseDevices: async () => {throw new Error('设备管理请用桌面版');},
  pendingSupabaseRequests: async () => {throw new Error('设备管理请用桌面版');},
  revokeSupabaseDevice: async () => {throw new Error('撤销设备请用桌面版');},
  refreshSupabase: async () => {throw new Error('云端同步请用桌面版');},
  openExternal: async url => { if (url.startsWith('https://')) window.open(url, '_blank', 'noopener,noreferrer'); },
  windowControl: () => {}, onUpdate: () => () => {},
  setWidgetRows:async()=>{},setWidgetPopover:async()=>{},
  collapseWidget:async()=>{},
  configureWidget: async () => {throw new Error('桌面小组件请在桌面版中设置');},hideWidget:async()=>{},pinWidget:async()=>{},selectWidgetDate:async()=>{},openWidgetTask:async()=>{},taskReady:async()=>null,onOpenTask:()=>()=>{},onNewTask:()=>()=>{}
};
