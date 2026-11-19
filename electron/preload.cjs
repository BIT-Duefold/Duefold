const { contextBridge, ipcRenderer } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('duefold', {
  load: invoke('data:load'), saveTasks: invoke('data:save'), login: invoke('platform:login'), scan: invoke('platform:scan'),
  checkSession: invoke('platform:check'),
  credentialStatus: invoke('auth:credential:status'),
  saveCredential: invoke('auth:credential:set'),
  clearCredential: invoke('auth:credential:clear'),
  configureCourses: invoke('platform:courses'),
  setTheme: invoke('appearance:theme'),
  disconnect: invoke('platform:disconnect'), readImport: invoke('file:import'), exportData: invoke('file:export'),
  configureSync: invoke('sync:configure'), openExternal: invoke('external:open'),
  joinSupabase: invoke('sync:supabase:join'), requestSupabaseDevice: invoke('sync:supabase:request'),
  approveSupabaseDevice: invoke('sync:supabase:approve'), denySupabaseDevice: invoke('sync:supabase:deny'),
  listSupabaseDevices: invoke('sync:supabase:devices'), pendingSupabaseRequests: invoke('sync:supabase:pending'),
  revokeSupabaseDevice: invoke('sync:supabase:revoke'), refreshSupabase: invoke('sync:supabase:refresh'),
  configureWidget: invoke('widget:configure'), hideWidget: invoke('widget:hide'), pinWidget: invoke('widget:pin'), selectWidgetDate: invoke('widget:date'), openWidgetTask: invoke('widget:open'),
  taskReady: invoke('task:ready'),
  setWidgetRows: invoke('widget:rows'), setWidgetPopover: invoke('widget:popover'),
  collapseWidget: invoke('widget:collapse'),
  onOpenTask: callback => {const listener = (_, id) => callback(id);ipcRenderer.on('task:open', listener);return () => ipcRenderer.removeListener('task:open', listener);},
  onNewTask: callback => {const listener = () => callback();ipcRenderer.on('task:new', listener);return () => ipcRenderer.removeListener('task:new', listener);},
  windowControl: action => ipcRenderer.send('window:control', action),
  onUpdate: callback => { const listener = (_, state) => callback(state); ipcRenderer.on('data:update', listener); return () => ipcRenderer.removeListener('data:update', listener); }
});
