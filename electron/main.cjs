const { app, BrowserWindow, ipcMain, session, net, safeStorage, dialog, shell, Menu, Tray, nativeTheme,systemPreferences, screen } = require('electron');
const {DesktopWidget} = require('./widget.cjs');
const {requestSession} = require('./session-request.cjs');
const {CampusSso,isCampusCookie,cookieDetails} = require('./campus-sso.cjs');
const {platformPage} = require('./platform-page.cjs');
const {watchSessionCookies} = require('./session-vault.cjs');
const path = require('node:path');
const fs = require('node:fs');
const {hostname} = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const {APP_NAME, APP_ID, APP_ICON, resolveDataDirectory} = require('./branding.cjs');
const {verifyProfileWritable} = require('./startup-profile.cjs');
app.setName(APP_NAME);
const dataDirectory = resolveDataDirectory(app.getPath('appData'), process.env.DUEFOLD_DATA_DIR);
try {verifyProfileWritable(dataDirectory);} catch (error) {
  console.error(`归序启动失败：${error.message}`);app.exit(1);
}
app.setPath('userData', dataDirectory);
app.setPath('sessionData', dataDirectory);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
let mainWindow, model, storage, parsers, sync, syncConfig, tasks = [], device, metadata = {}, config, syncStatus = '仅本机';
let secrets = {platforms: {}, syncToken: ''}; let quitting = false;
let syncState = {}, supabaseIdentity = null;
let themeMode='system';
let widget, pendingTaskId = null;
let tray = null, pendingNewTask = false;
const windows = new Map();
const platformSessions = new Map();
const sessionLoads = new Map();
const sessionVaults = new Map();
let yanheAuthModule, yanheAuth, campusSso;
let yanheDisconnecting = false;
let yanheEpoch = 0;
let authExpiryTimer;
let yanheAssignments, yanheCollectPending, yanheCollectAbort, yanheWorker, yanheCollectTimer;
let yanheLastCollectAttempt = 0;
let yanheWasSignedIn = false;
let moocAssignments, moocPending, moocAbort, moocWorker, moocTimer, moocEpoch=0, moocDisconnecting=false, moocLastAttempt=0;
let lexueAssignments, lexuePending, lexueAbort, lexueWorker, lexueTimer, lexueEpoch=0, lexueDisconnecting=false, lexueLastAttempt=0;
let coursePreferences = {catalog: {}, excluded: {}}, coursePrefsModel;
// Active (most recently verified) account per platform. Tasks carry their account so a
// different login hides the previous one's entries without deleting local edits.
let accounts = {};
const platformIDs = ['yanhe', 'lexue', 'mooc', 'zhihuishu'];
const roots = {yanhe: ['yanhekt.cn', 'bit.edu.cn'], lexue: ['bit.edu.cn'], mooc: ['icourse163.org', 'passport.163.com', 'reg.163.com'], zhihuishu: ['zhihuishu.com']};
function trusted(url, id) {try {const u = new URL(url);return u.protocol === 'https:' && roots[id].some(d => u.hostname === d || u.hostname.endsWith('.' + d));} catch {return false;}}
function platform(id) {if (!platformIDs.includes(id)) throw new Error('未知平台');return id;}
function file(name) {return path.join(app.getPath('userData'), name);}
function canEncrypt() {return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()));}
function saveSecrets() {
  if (!canEncrypt()) return false;
  const buffer = safeStorage.encryptString(JSON.stringify(secrets));
  storage.atomicWrite(file('vault.json'), {encrypted: buffer.toString('base64')});return true;
}
function persistMetadata() {storage.atomicWrite(file('settings.json'), {device, metadata, config, syncState, coursePreferences,themeMode,accounts});}
let casPasswordModule = null;
const loadCasPassword = () => (casPasswordModule ||= import('./cas-password.mjs'));
let lexueSessionModule = null;
const loadLexueSession = () => (lexueSessionModule ||= import('./lexue-session.mjs'));
function readCredential() {
  const saved = secrets.campusCredential;
  if (!saved || typeof saved !== 'object') return null;
  return {
    username: typeof saved.username === 'string' ? saved.username : '',
    password: typeof saved.password === 'string' ? saved.password : '',
    auto: saved.auto === true,
    failures: Number.isInteger(saved.failures) && saved.failures >= 0 ? saved.failures : 0,
    cooldownUntil: Number.isFinite(saved.cooldownUntil) ? saved.cooldownUntil : 0
  };
}
function credentialStatus() {
  const saved = readCredential();
  return {saved: !!(saved && saved.username && saved.password), username: saved?.username || null, auto: !!saved?.auto, failures: saved?.failures || 0, cooldownUntil: saved?.cooldownUntil || 0};
}
function validAccounts(value) {
  const result = {};
  for (const id of ['yanhe', 'lexue', 'mooc']) {
    const account = value?.[id];
    if (typeof account === 'string' && account && account.length <= 100 && !account.includes('|')) result[id] = account;
  }
  return result;
}
function validCredential(input) {
  if (!input || typeof input !== 'object') throw new Error('账号信息无效');
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!username || username.length > 128 || /[\u0000-\u001f\u007f]/.test(username)) throw new Error('请输入有效的统一认证学号或用户名');
  if (!password || password.length > 256) throw new Error('请输入有效的统一认证密码');
  if (typeof input.auto !== 'boolean') throw new Error('保存密码设置无效');
  return {username, password, auto: input.auto};
}
async function noteCredentialFailure() {
  const saved = readCredential();
  if (!saved) return;
  const failures = saved.failures + 1;
  secrets.campusCredential = {...secrets.campusCredential, failures, auto: failures >= 3 ? false : saved.auto};
  if (!saveSecrets()) throw new Error('系统安全存储暂不可用');
  publish();
}
// A challenge (SMS/captcha) must be solved by the user; stop automatic password attempts for a while.
async function noteCredentialCooldown(minutes) {
  const saved = readCredential();
  if (!saved) return;
  const until = Date.now() + minutes * 60 * 1000;
  secrets.campusCredential = {...secrets.campusCredential, cooldownUntil: Math.max(saved.cooldownUntil, until)};
  if (!saveSecrets()) throw new Error('系统安全存储暂不可用');
  publish();
}
const noteCredentialChallenge = () => noteCredentialCooldown(30);
// Lexue keeps its own Moodle session; refresh it with the shared campus password when possible.
async function refreshLexueSession() {
  if (quitting || lexueDisconnecting) return false;
  const saved = readCredential();
  if (!saved || !saved.username || !saved.password || saved.auto === false || saved.cooldownUntil > Date.now()) return false;
  const ses = await getPlatformSession('lexue');
  const request = (url, options) => requestSession(net, ses, url, options);
  const lexue = await loadLexueSession();
  const discovered = await lexue.discoverLexueService(request);
  if (!discovered) return false;
  const cas = await loadCasPassword();
  let result;
  try {result = await cas.passwordSignIn({service: discovered.service, username: saved.username, password: saved.password, request});}
  catch (error) {
    if (error?.code === 'captcha_required') await noteCredentialCooldown(30).catch(() => {});
    else if (error?.code !== 'bad_credentials') await noteCredentialCooldown(10).catch(() => {});
    throw error;
  }
  if (result?.kind === 'second_factor') {await noteCredentialCooldown(30).catch(() => {});return false;}
  if (result?.kind !== 'ticket' || !result.url) {await noteCredentialCooldown(10).catch(() => {});return false;}
  await lexue.followLexueTicket(request, result.url);
  return true;
}
function snapshot() {return {tasks, accounts: {...accounts}, device, connections: metadata, settings: {...syncConfig.syncSettings(config, secrets, supabaseIdentity), defaultDeviceName: hostname().slice(0, 80)}, coursePreferences, syncStatus,themeMode, credential: credentialStatus(), widget: widget?.state()};}
const taskAccountVisible = (task, map = accounts) => !task.sourceAccount || !map?.[task.platform] || task.sourceAccount === map[task.platform];
function scopedSnapshot() {const state = snapshot();return {...state, tasks: state.tasks.filter(task => taskAccountVisible(task, state.accounts))};}
function publish() {const state = snapshot();if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('data:update', state);widget?.publish(scopedSnapshot(), !mainWindow || mainWindow.isDestroyed());}
function accountRows(id, rows) {const account = accounts[id];return account ? rows.map(row => ({...row, sourceAccount: account})) : rows;}
// The grade report defines the current todo set for a course; older items that are no
// longer listed are archived (kept as tombstones) instead of lingering in the list.
function pruneLexueCourse(courseId, sourceIds) {
  const account = accounts.lexue;if (!account) return;
  const valid = new Set(sourceIds);
  const stale = tasks.filter(task => {
    if (task.platform !== 'lexue' || task.deleted || task.sourceAccount !== account) return false;
    const source = model.importSource(task), course = /^moodle:(\d+):/.exec(source)?.[1];
    return course === String(courseId) && !valid.has(source);
  });
  if (!stale.length) return;
  tasks = model.archiveTasks(tasks, stale.map(task => task.id), device);
  storage.atomicWrite(file('tasks.json'), tasks);
  publish();
}
// Never prune on a run that produced no todos at all: that signals a parser or account
// mismatch, and treating it as "all items removed" would wipe a valid list.
function pruneLexueCourses(read, assignments) {
  if (!assignments.length) return;
  const byCourse = new Map();
  for (const item of assignments) {
    const course = /^moodle:(\d+):/.exec(item.sourceId)?.[1];if (!course) continue;
    const list = byCourse.get(course) || [];list.push(item.sourceId);byCourse.set(course, list);
  }
  for (const entry of read) pruneLexueCourse(entry.id, byCourse.get(String(entry.id)) || []);
}
// Store only a per-platform anonymous key so the renderer, backups and sync never hold
// a raw student number while still distinguishing accounts reliably.
function accountKey(id, value) {
  return createHash('sha256').update(`${id}:${value}`).digest('hex').slice(0, 32);
}
function recordPlatformAccount(id, value) {
  const raw = ['string', 'number'].includes(typeof value) ? String(value).trim().slice(0, 100) : '';
  if (!raw || raw.includes('|')) return;
  const account = accountKey(id, raw);
  if (accounts[id] === account) return;
  const previous = accounts[id], first = !previous;
  accounts = {...accounts, [id]: account};
  if (first) {tasks = model.scopeTasksToAccount(tasks, id, account, device);storage.atomicWrite(file('tasks.json'), tasks);}
  else if (metadata[id]) metadata[id] = {...metadata[id], detail: '已切换平台账号，上一账号的待办已隐藏但保留；切回原账号即可恢复。'};
  persistMetadata();publish();
}
function nativeCaptionColors() {
  if(nativeTheme.shouldUseHighContrastColors&&process.platform==='win32')return {color:systemPreferences.getColor('window'),symbolColor:systemPreferences.getColor('window-text'),height:36};
  return {color:nativeTheme.shouldUseDarkColors?'#101114':'#f5f7fb',symbolColor:nativeTheme.shouldUseDarkColors?'#f4f2ed':'#202733',height:36};
}
function setTasks(incoming, push = false) {const merged = model.validateTasks(model.mergeTasks(tasks, incoming));storage.atomicWrite(file('tasks.json'), merged);tasks = merged;publish();if (push) sync.push();}
function assertSender(event) {if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('不受信任的调用');}
function handle(name, fn) {ipcMain.handle(name, (event, ...args) => {assertSender(event);return fn(...args);});}
async function getPlatformSession(id) {
  if (sessionLoads.has(id)) return sessionLoads.get(id);
  if (platformSessions.has(id)) return platformSessions.get(id);
  const pending = (async () => {
    const ses = session.fromPartition(`duefold-${id}-${randomUUID()}`, {cache: false});
    platformSessions.set(id, ses);
    ses.setPermissionRequestHandler((_, __, callback) => callback(false));ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', event => event.preventDefault());
    for (const c of secrets.platforms[id]?.cookies || []) {
      try {
        const {hostOnly, session: isSession, ...details} = c;const domain = c.domain.replace(/^\./, '');
        if (['yanhe','lexue'].includes(id) && isCampusCookie(c)) continue;
        if (!trusted(`https://${domain}/`, id) || (c.expirationDate && c.expirationDate * 1000 <= Date.now())) continue;
        await ses.cookies.set(cookieDetails(c));
      } catch {}
    }
    await campusSso.flush();await campusSso.attach(id,ses);
    if(['mooc','lexue'].includes(id))sessionVaults.set(id,watchSessionCookies(ses,{
      trusted:url=>trusted(url,id),read:()=>secrets.platforms[id],
      write:saved=>{if(id==='mooc'?moocDisconnecting:lexueDisconnecting)return;secrets.platforms[id]=saved;const encrypted=saveSecrets();metadata[id]={...metadata[id],saved:encrypted&&saved.cookies.length>0};persistMetadata();publish();}
    }));
    return ses;
  })();
  sessionLoads.set(id, pending);
  try {return await pending;} finally {sessionLoads.delete(id);}
}
async function getYanheAuth() {
  if (yanheDisconnecting) throw new Error('正在断开延河会话，请稍后操作');
  const epoch = yanheEpoch;
  const ses = await getPlatformSession('yanhe');
  if (yanheDisconnecting || epoch !== yanheEpoch) throw new Error('延河会话已断开');
  if (yanheAuth) return yanheAuth;
  yanheAuth = new yanheAuthModule.YanheSession({
    read: () => secrets.platforms.yanhe?.auth || {},
    write: auth => {
      const saved = secrets.platforms.yanhe || {cookies: [], origins: {}};
      secrets.platforms.yanhe = {...saved, auth};
      const encrypted = saveSecrets();metadata.yanhe = {...metadata.yanhe, saved: encrypted};
    },
    cookies: () => ses.cookies.get({name: '_token'}),
    clearToken: async jwt => {
      for (const c of await ses.cookies.get({name: '_token'})) {
        if (yanheAuthModule.isYanheTokenCookie(c) && yanheAuthModule.tokenFromCookie(c.value) === jwt) await ses.cookies.remove(`https://${c.domain.replace(/^\./, '')}${c.path || '/'}`, c.name);
      }
      const saved = secrets.platforms.yanhe;if (!saved) return;
      // Remove only credentials matching the rejected token; retain other site preferences/drafts.
      for (const origin of Object.values(saved.origins || {})) for (const area of ['local','session']) for (const [key,value] of Object.entries(origin[area] || {})) if (typeof value === 'string' && value.includes(jwt)) delete origin[area][key];
      saved.cookies = (saved.cookies || []).filter(c => !yanheAuthModule.isYanheTokenCookie(c) || yanheAuthModule.tokenFromCookie(c.value) !== jwt);
      const entry = windows.get('yanhe');
      if (entry && !entry.window.isDestroyed() && trusted(entry.window.webContents.getURL(), 'yanhe')) {
        await entry.window.webContents.executeJavaScript(`(()=>{const token=${JSON.stringify(jwt)};for(const area of [localStorage,sessionStorage])for(const key of Object.keys(area)){const value=area.getItem(key);if(value&&value.includes(token))area.removeItem(key)}})()`).catch(() => {});
      }
      saveSecrets();
    },
    request: (url, options) => requestSession(net, ses, url, options),
    credential: () => {
      const saved = readCredential();
      if (!saved || !saved.username || !saved.password) return null;
      return {enabled: saved.auto && saved.cooldownUntil <= Date.now(), username: saved.username, password: saved.password};
    },
    passwordSignIn: async ({service, username, password}) => {
      const cas = await loadCasPassword();
      return cas.passwordSignIn({service, username, password, request: (url, options) => requestSession(net, ses, url, options)});
    },
    onPasswordFailure: async () => {await noteCredentialFailure();},
    onPasswordChallenge: async () => {await noteCredentialChallenge();},
    onState: auth => {
      if (quitting) return;
      clearTimeout(authExpiryTimer);
      if (auth.state === 'signed_in' && auth.expiresAt) {
        authExpiryTimer = setTimeout(() => {if (!quitting && !yanheDisconnecting) void checkYanhe().catch(() => {});}, Math.max(1000, Math.min(2147483647, Date.parse(auth.expiresAt) - Date.now())));
        authExpiryTimer.unref();
      }
      metadata.yanhe = {...metadata.yanhe, auth};
      if (['expired','renewing','verification_required','account_mismatch'].includes(auth.state)) windows.get('yanhe')?.captured.clear();
      if (yanheWorker && ['expired','verification_required','account_mismatch','network','unsafe_redirect'].includes(auth.state)) yanheCollectAbort?.abort();
      persistMetadata();publish();
      if (auth.state === 'signed_in' && secrets.campusCredential?.failures) {secrets.campusCredential.failures = 0;saveSecrets();publish();}
      if (auth.state === 'signed_in') {const regained = !yanheWasSignedIn;yanheWasSignedIn = true;scheduleYanheCollection(regained);}
      else if (!['checking','renewing'].includes(auth.state)) yanheWasSignedIn = false;
    }
  });
  return yanheAuth;
}
// Saving the campus password signs in every connected campus platform, not only Yanhe.
async function loginSavedPlatforms() {
  const saved = readCredential();
  if (!saved || !saved.username || !saved.password || saved.auto === false || saved.cooldownUntil > Date.now()) return;
  const work = [checkYanhe({recover: true, force: true}).catch(() => {})];
  if (secrets.platforms.lexue) work.push(Promise.resolve().then(() => scheduleLexueCollection(true)));
  await Promise.allSettled(work);
}
async function checkYanhe(options = {}) {
  const auth = await getYanheAuth();const previousToken = secrets.platforms.yanhe?.auth?.jwt;const result = await auth.check(options);
  if (!auth.disposed && !quitting && !yanheDisconnecting) {
    const saved = secrets.platforms.yanhe;
    if (saved) {
      const cookies = (await (await getPlatformSession('yanhe')).cookies.get({})).filter(c => trusted(`https://${c.domain.replace(/^\./, '')}/`, 'yanhe'));
      if (!auth.disposed && secrets.platforms.yanhe) {secrets.platforms.yanhe.cookies = cookies;saveSecrets();}
    }
    const entry = windows.get('yanhe');
    if (previousToken && result.state === 'signed_in' && previousToken !== secrets.platforms.yanhe?.auth?.jwt && entry && !entry.window.isDestroyed() && !entry.window.webContents.isLoading()) {
      entry.skipRestore = true;entry.captured.clear();entry.window.webContents.reload();
    }
  }
  if (result.state === 'signed_in') recordPlatformAccount('yanhe', secrets.platforms.yanhe?.auth?.account);
  return result;
}
async function loginPlatform(id) {
  if (id === 'mooc') {
    const entry=await openPlatform(id,true);
    if(metadata.mooc?.collection?.needsLogin) void entry.navigate(model.PLATFORMS.mooc.url);
    return '在 MOOC 官方窗口完成登录后，自动读取 SPOC 课程的测验与作业，无需逐门打开。';
  }
  if (id === 'lexue') {
    const entry=await openPlatform(id,true);
    if(metadata.lexue?.auth?.state!=='signed_in'&&!entry.window.webContents.isLoading())void entry.navigate(model.PLATFORMS.lexue.url);
    return '乐学将尝试复用北理工统一认证；认证仍有效时无需再次输入密码，过期时请在官方窗口验证。';
  }
  if (id !== 'yanhe') {await openPlatform(id, true);return '完成登录并进入作业列表后，请切回归序点击读取作业。关闭平台窗口仍保留会话。';}
  if (metadata.yanhe?.auth?.state === 'account_mismatch') return metadata.yanhe.auth.message;
  const existing = windows.get(id);
  const loginURL = metadata.yanhe?.collection?.needsLogin ? yanheAssignments.ECLASS_ORIGIN + '/' : yanheAuthModule.YANHE_CAS;
  const entry = await openPlatform(id, true, loginURL);
  const url = entry.window.webContents.getURL();
  if (existing && (metadata.yanhe?.collection?.needsLogin || !/sso\.|login\.bit\.edu\.cn|\/authserver\/|\/cas\/login|\/casapi\//i.test(url) && metadata.yanhe?.auth?.state !== 'signed_in')) {
    entry.skipRestore = true;
    void entry.navigate(loginURL);
  }
  return '已打开官方登录窗口，请在窗口内完成认证；检测到新会话后会自动核验。';
}
function wireIPC() {
  ipcMain.handle('data:load', event => {if (widget?.owns(event)) return widget.load();assertSender(event);return snapshot();});
  handle('widget:configure', async input => {const result = await widget.configure(input);refreshTrayMenu();return result;});
  for (const [channel, action] of Object.entries({
    'widget:hide': async () => {const result = await widget.configure({enabled: false});refreshTrayMenu();return result;},
    'widget:pin': pinned => widget.configure({pinned}),
    'widget:collapse': () => widget.collapse(true),
    'widget:date': date => widget.selectDate(date),
    'widget:rows': rows => widget.setRows(rows),
    'widget:popover': (kind, anchor) => widget.setPopover(kind, anchor),
    'widget:open': async id => {
      if (typeof id !== 'string' || !widget.load().tasks.some(t => t.id === id && !t.deleted)) throw new Error('待办不存在');
      if (!tasks.some(t => t.id === id && !t.deleted)) {await showMainWindow();throw new Error('此待办已删除，已为你打开主窗口');}
      pendingTaskId = id;await showMainWindow();
      if (mainRendererReady && pendingTaskId) {mainWindow.webContents.send('task:open', pendingTaskId);pendingTaskId = null;}
    }
  })) ipcMain.handle(channel, (event, ...args) => {if (!widget?.owns(event)) throw new Error('不受信任的调用');return action(...args);});
  handle('task:ready', () => {
    mainRendererReady = true;
    if (pendingNewTask) {
      pendingNewTask = false;
      mainWindow?.webContents.send('task:new');
    }
    const id = pendingTaskId;pendingTaskId = null;return id;
  });
  handle('data:save', incoming => setTasks(model.validateTasks(incoming), true));
  handle('appearance:theme',mode=>{
    if(!['system','light','dark'].includes(mode))throw new Error('外观模式无效');
    themeMode=mode;nativeTheme.themeSource=mode;persistMetadata();publish();
  });
  handle('platform:login', id => loginPlatform(platform(id)));
  handle('platform:check', async id => {if (platform(id) !== 'yanhe') throw new Error('当前仅支持延河的服务端认证检查');return checkYanhe({recover: true, force: true});});
  handle('auth:credential:status', () => credentialStatus());
  handle('auth:credential:set', input => {
    const next = validCredential(input);
    if (!canEncrypt()) throw new Error('系统安全存储不可用，无法保存登录密码');
    secrets.campusCredential = {username: next.username, password: next.password, auto: next.auto, failures: 0, cooldownUntil: 0, updatedAt: new Date().toISOString()};
    if (!saveSecrets()) {delete secrets.campusCredential;throw new Error('系统安全存储不可用，无法保存登录密码');}
    publish();
    if (next.auto) void loginSavedPlatforms();
    return credentialStatus();
  });
  handle('auth:credential:clear', () => {
    delete secrets.campusCredential;
    saveSecrets();publish();
    return credentialStatus();
  });
  handle('platform:scan', id => scanPlatform(platform(id), !windows.has(id)));
  handle('platform:courses', async (id, excluded) => {
    platform(id);
    const next = coursePrefsModel.validateCoursePreferences({...coursePreferences, excluded: {...coursePreferences.excluded,[id]:excluded}});
    coursePreferences = next;persistMetadata();publish();
    if(id === 'lexue') {
      if(lexuePending){lexueAbort?.abort('course_selection_changed');await lexuePending.catch(()=>{});}
      if(secrets.platforms.lexue)scheduleLexueCollection(true);
    }
    if(id === 'mooc') {
      if(moocPending){moocAbort?.abort('course_selection_changed');await moocPending.catch(()=>{});}
      if(secrets.platforms.mooc)scheduleMoocCollection(true);
    }
    if (id === 'yanhe') {
      if (yanheCollectPending) {yanheCollectAbort?.abort('course_selection_changed');await yanheCollectPending.catch(() => {});}
      if (metadata.yanhe?.auth?.state === 'signed_in') scheduleYanheCollection(true);
    }
  });
  handle('platform:disconnect', async id => {
    platform(id);if(id==='lexue'){lexueDisconnecting=true;lexueEpoch++;clearTimeout(lexueTimer);lexueTimer=null;lexueLastAttempt=0;lexueAbort?.abort();if(lexueWorker&&!lexueWorker.isDestroyed())lexueWorker.destroy();await lexuePending?.catch(()=>{});}
    if(id==='mooc'){moocDisconnecting=true;moocEpoch++;clearTimeout(moocTimer);moocTimer=null;moocLastAttempt=0;moocAbort?.abort();if(moocWorker&&!moocWorker.isDestroyed())moocWorker.destroy();await moocPending?.catch(()=>{});}
    if (id === 'yanhe') {
      yanheDisconnecting = true;yanheEpoch++;clearTimeout(authExpiryTimer);clearTimeout(yanheCollectTimer);yanheLastCollectAttempt = 0;yanheWasSignedIn = false;
      yanheCollectAbort?.abort();if (yanheWorker && !yanheWorker.isDestroyed()) yanheWorker.destroy();yanheWorker = null;
      await yanheCollectPending?.catch(() => {});
      delete secrets.campusCredential;
    }
    try {
    if (id === 'yanhe' && yanheAuth) {const old = yanheAuth;yanheAuth = null;await old.dispose();}
    campusSso.detach(id);await campusSso.flush();
    sessionVaults.get(id)?.dispose();sessionVaults.delete(id);
    const entry = windows.get(id); windows.delete(id);
    if (entry) {entry.disconnected = true;clearTimeout(entry.captureTimer);clearTimeout(entry.readTimer);entry.window.destroy();await entry.session.clearStorageData();await entry.session.clearCache();}
    const ses = await sessionLoads.get(id) || platformSessions.get(id);
    if (ses) {await ses.clearStorageData();await ses.clearCache();}platformSessions.delete(id);
    delete secrets.platforms[id];delete metadata[id];saveSecrets();persistMetadata();publish();
    } finally {if (id === 'yanhe') yanheDisconnecting = false;if(id==='mooc')moocDisconnecting=false;if(id==='lexue')lexueDisconnecting=false;}
  });
  handle('file:import', async () => {
    const chosen = await dialog.showOpenDialog(mainWindow, {title: '导入待办或日历', properties: ['openFile'], filters: [{name: '待办 / 日历', extensions: ['json', 'ics']}]});
    if (chosen.canceled) return null;const p = chosen.filePaths[0];if (fs.statSync(p).size > 8 * 1024 * 1024) throw new Error('文件不能超过 8 MB');
    return {text: fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''), name: path.basename(p)};
  });
  handle('file:export', async text => {
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw new Error('导出内容无效');
    const payload = JSON.parse(text);model.validateTasks(payload.tasks);
    const chosen = await dialog.showSaveDialog(mainWindow, {title: '备份待办', defaultPath: `归序-待办备份-${model.dayKey()}.json`, filters: [{name: 'JSON', extensions: ['json']}]});
    if (chosen.canceled) return false;fs.writeFileSync(chosen.filePath, text, 'utf8');return true;
  });
  handle('sync:configure', async input => {
    const next = syncConfig.prepareSyncConfiguration(input, config, secrets.syncToken);
    const credentials = {syncToken: next.token};
    sync.validateConfig(next.config, credentials);
    if (next.config.enabled && !canEncrypt()) throw new Error('系统安全存储暂不可用，无法保存同步密钥');
    if (next.config.enabled && next.config.provider === 'supabase' && secrets.supabaseSession && secrets.supabaseSession.projectUrl !== next.config.supabase.url) throw new Error('云端项目与已保存的登录不一致，请使用原项目');
    secrets.syncToken = next.token;saveSecrets();
    if (config.provider !== next.config.provider || config.supabase.url !== next.config.supabase.url) syncState = {};
    sync.close();config = next.config;persistMetadata();sync.configure(config, credentials);publish();
  });
  for (const action of ['join', 'request', 'approve', 'deny', 'devices', 'pending', 'revoke', 'refresh']) {
    handle(`sync:supabase:${action}`, input => sync.supabaseOperation(action, input));
  }
  handle('external:open', async url => {if (typeof url !== 'string' || url.length > 3000 || !platformIDs.some(id => trusted(url, id))) throw new Error('只支持打开受信任教学平台的 HTTPS 链接');await shell.openExternal(url);});
  ipcMain.on('window:control', (event, action) => {try {assertSender(event);} catch {return;}if (action === 'minimize') mainWindow.minimize();if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();if (action === 'close') mainWindow.close();if (action === 'quit') app.quit();});
}
async function capture(entry) {
  if (entry.window.isDestroyed() || entry.restoring || entry.disconnected) return;
  const id = entry.id;
  const cookies = (await entry.session.cookies.get({})).filter(c => {
    const hostname = c.domain.replace(/^\./, '');return roots[id].some(d => hostname === d || hostname.endsWith('.' + d));
  });
  let originData = null;
  const url = entry.window.webContents.getURL();
  if (trusted(url, id)) {
    try {
      const data = await entry.window.webContents.executeJavaScript('({origin:location.origin,local:{...localStorage},session:{...sessionStorage}})');
      if (JSON.stringify(data).length < 2 * 1024 * 1024) originData = data;
    } catch {}
  }
  if (entry.disconnected) return;
  const saved = {...(secrets.platforms[id] || {origins: {}}), cookies};
  saved.origins = {...saved.origins};if (originData) saved.origins[originData.origin] = {local: originData.local, session: originData.session};
  secrets.platforms[id] = saved;
  const hasSession = saved.cookies.length > 0 || Object.values(saved.origins).some(o => Object.keys(o.local).length || Object.keys(o.session).length);
  const encrypted = saveSecrets(); metadata[id] = {...metadata[id], saved: !!(encrypted && (hasSession || saved.auth?.jwt || saved.auth?.account)), status: metadata[id]?.status || '需核验', detail: metadata[id]?.detail || (encrypted ? id === 'yanhe' ? '已保存本机会话，登录核验成功后将自动读取课程和事项。' : '已保存页面会话。请进入作业列表后读取；课程覆盖仍需核验。' : '系统加密不可用，会话仅在本次运行中保留。')};
  persistMetadata();publish();
}
async function restorePageStorage(win,id) {
  const url=win.webContents.getURL();if(!trusted(url,id))return false;
  const data=secrets.platforms[id]?.origins?.[new URL(url).origin];if(!data)return false;
  return win.webContents.executeJavaScript(`(()=>{const d=${JSON.stringify(data).replace(/</g,'\\u003c')};let changed=false;for(const [area,values] of [[localStorage,d.local],[sessionStorage,d.session]])for(const [k,v] of Object.entries(values||{}))if(area.getItem(k)===null){area.setItem(k,v);changed=true;}return changed;})()`);
}
async function openPlatform(id, show, initialURL = model.PLATFORMS[id].url) {
  let entry = windows.get(id);
  if (entry && !entry.window.isDestroyed()) {if (show) {entry.window.show();entry.window.focus();}return entry;}
  const ses = await getPlatformSession(id);
  const win = new BrowserWindow({width: 1100, height: 780, title: `${model.PLATFORMS[id].name} · ${['yanhe','mooc','lexue'].includes(id) ? '官方登录，完成后自动读取已选课程' : '登录后进入作业页，再回归序读取'}`, show,
    backgroundColor: '#f7faf8', webPreferences: {session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, navigateOnDragDrop: false}});
  entry = {id, window: win, session: ses, restoring: false, restored: new Set(), captured: new Map(), loading: null};windows.set(id, entry);
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(({url}) => {if (trusted(url, id)) void win.loadURL(url).catch(() => {});return {action: 'deny'};});
  win.webContents.on('will-navigate', (event, url) => {if (!trusted(url, id)) event.preventDefault();});
  win.webContents.on('will-redirect', (event, url) => {if (!trusted(url, id)) event.preventDefault();});
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  const showFailure = code => {
    if (entry.disconnected || win.isDestroyed() || entry.showingFailure) return;
    entry.showingFailure = true;clearTimeout(entry.loadTimer);
    metadata[id] = {...metadata[id], status: '页面未能打开', detail: '官方页面加载失败，请在平台窗口查看原因并重试。'};publish();
    void win.loadURL(platformPage(model.PLATFORMS[id].name, initialURL, code)).catch(() => {});
  };
  win.webContents.on('did-fail-load', (_, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) showFailure(description);
  });
  const armLoadTimer = () => {
    clearTimeout(entry.loadTimer);
    entry.loadTimer = setTimeout(() => {if (win.webContents.isLoadingMainFrame()) {win.webContents.stop();showFailure('ERR_TIMED_OUT');}}, 30000);
  };
  entry.navigate = async url => {
    if (entry.disconnected || win.isDestroyed()) return;
    entry.showingFailure = false;armLoadTimer();
    try {await win.loadURL(url);} catch (error) {if (error.code !== 'ERR_ABORTED') showFailure(error.code);}
  };
  win.webContents.on('did-start-navigation', (_, url, isInPlace, isMainFrame) => {if (isMainFrame && !isInPlace && trusted(url, id)) {entry.showingFailure = false;armLoadTimer();}});
  const scheduleRead = () => {
    if (id === 'yanhe') {scheduleYanheCollection();return;}
    if (id === 'mooc') {scheduleMoocCollection();return;}
    if (id === 'lexue') {if(metadata.lexue?.auth?.state==='signed_in')scheduleLexueCollection();return;}
    clearTimeout(entry.readTimer);entry.readTimer = setTimeout(async () => {
      if (entry.disconnected || quitting || entry.scanning) return;entry.scanning = true;
      try {const result = await scanPlatform(id, false);if (result.assignments.length) setTasks(model.importAssignments(tasks, result.assignments, device), true);} catch {} finally {entry.scanning = false;}
    }, 3000);
  };
  const scheduleCapture = () => {clearTimeout(entry.captureTimer);entry.captureTimer = setTimeout(async () => {
    try {
      await capture(entry);
      if(id==='lexue'&&!entry.disconnected) await checkLexue(entry);
      if(id==='mooc'&&!entry.disconnected) {
        const valid=await entry.window.webContents.executeJavaScript(`location.origin==='https://www.icourse163.org'&&!!window.webUser?.id`).catch(()=>false);
        if(valid)scheduleMoocCollection(metadata.mooc?.collection?.needsLogin||metadata.mooc?.auth?.state!=='signed_in');
      }
      if (id === 'yanhe' && !entry.disconnected) {
        const result = await checkYanhe({recover: false});
        if (result.state === 'signed_in' && metadata.yanhe?.collection?.needsLogin && entry.window.webContents.getURL().startsWith(yanheAssignments.ECLASS_ORIGIN + '/')) scheduleYanheCollection(true);
      }
    } catch {}
  }, 1500);scheduleRead();};
  win.webContents.on('did-navigate-in-page', scheduleCapture);
  const cookieChanged = (_, cookie) => {if (id !== 'yanhe' || cookie.name === '_token') scheduleCapture();};
  ses.cookies.on('changed', cookieChanged);
  win.on('closed', () => {clearTimeout(entry.loadTimer);ses.cookies.removeListener('changed', cookieChanged);});
  win.on('close', event => {if (!quitting) {event.preventDefault();void Promise.all([capture(entry),sessionVaults.get(id)?.capture()]).catch(() => {});win.hide();mainWindow.show();}});
  win.webContents.on('did-finish-load', async () => {
    clearTimeout(entry.loadTimer);
    const url = win.webContents.getURL();if (!trusted(url, id)) return;
    const origin = new URL(url).origin;
    const data = secrets.platforms[id]?.origins?.[origin];
    if (data && !entry.skipRestore && !entry.restored.has(origin)) {
      entry.restored.add(origin);entry.restoring = true;
      try {await restorePageStorage(win,id);} catch {}
      entry.restoring = false;win.webContents.reload();return;
    }
    scheduleCapture();
  });
  // Commit visible content before attaching network observation to the new renderer.
  await win.loadURL(platformPage(model.PLATFORMS[id].name, initialURL)).catch(() => {});
  // Observe only assignment-related JSON responses. Never intercept credentials or upload page traffic.
  try {
    win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Network.enable');
    const requests = new Map();
    win.webContents.debugger.on('message', async (_, method, params) => {
      if (method === 'Network.responseReceived') {
        const r = params.response;
        const parsed = new URL(r.url);
        if (r.status === 200 && trusted(r.url, id) && /json/i.test(r.mimeType) && /assign|homework|exam|quiz|task|calendar|activity|course|clazz/i.test(parsed.pathname + (parsed.searchParams.get('r') || ''))) requests.set(params.requestId, r.url);
      } else if (method === 'Network.loadingFailed') requests.delete(params.requestId);
      else if (method === 'Network.loadingFinished' && requests.has(params.requestId)) {
        const url = requests.get(params.requestId); requests.delete(params.requestId);
        if (params.encodedDataLength > 4 * 1024 * 1024) return;
        try {const body = await win.webContents.debugger.sendCommand('Network.getResponseBody', {requestId: params.requestId});const json = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body);
          if (!['yanhe','mooc','lexue'].includes(id)) rememberCourseNames(id, parsers.extractCourseNames(json, url));
        const assignments = ['yanhe','mooc','lexue'].includes(id) ? [] : parsers.extractAssignments(json, id, url);
          for (const a of assignments) entry.captured.set(a.sourceId, a);
          if (assignments.length) scheduleRead();
          if (entry.captured.size > 5000) entry.captured.clear();
        } catch {}
      }
    });
  } catch {}
  entry.loading = entry.navigate(initialURL);
  return entry;
}
async function scanPlatform(id, show = true) {
  if (id === 'yanhe') return collectYanhe();
  if (id === 'mooc') return collectMooc();
  if (id === 'lexue') return collectLexue();
  const entry = await openPlatform(id, show); const win = entry.window;
  if (win.webContents.isLoading()) throw new Error('平台页面仍在加载，请完成登录并打开作业页后再读取');
  if (!trusted(win.webContents.getURL(), id)) throw new Error('请先在平台窗口完成登录');
  const page = await win.webContents.executeJavaScript(`(${parsers.scanPage.toString()})()`);
  if (page.loginPage || /sso\.|login\.|\/login\b|\/authserver\//i.test(page.url)) throw new Error('当前处于登录页，请完成身份认证后再读取');
  const items = [...entry.captured.values()];
  for (const a of page.items) {try {items.push({...a, dueAt: model.parseDeadline(a.dueAt), platform: id});} catch {}}
  rememberCourseNames(id, [...(page.courses || []), ...items.map(a => a.course).filter(Boolean)]);
  const assignments = [...new Map(items.map(a => [String(a.sourceId), a])).values()].filter(a => !a.course || coursePrefsModel.courseEnabled(coursePreferences, id, 'name:' + a.course));
  // Validate without writing; renderer commits imports through the shared mutation path.
  model.importAssignments(tasks, assignments, device);
  let message = assignments.length ? `读取到 ${assignments.length} 项截止事件；仅覆盖当前页面和已加载接口，请核对其他课程与分页。` : '未识别到可验证的截止事件。请进入具体作业列表再读取，或导入 ICS 日历；这不表示没有作业。';
  metadata[id] = {...metadata[id], status: assignments.length ? '部分已读取' : '需核验', count: assignments.length, lastScan: new Date().toISOString(), detail: message};
  await capture(entry);persistMetadata();publish();return {assignments, message};
}
function rememberCourseNames(id, names) {
  const rows = [...new Set(names)].filter(name => typeof name === 'string' && name.trim() && name.length <= 200).slice(0,1000).map(title => ({id: 'name:' + title, title}));
  if (!rows.length) return;
  const next = coursePrefsModel.updateCourseCatalog(coursePreferences, id, rows);
  if (JSON.stringify(next) !== JSON.stringify(coursePreferences)) {coursePreferences = next;persistMetadata();publish();}
}
async function checkLexue(entry) {
  if(entry.disconnected || entry.window.isDestroyed()) return;
  const wasSignedIn=metadata.lexue?.auth?.state==='signed_in';
  const state=await entry.window.webContents.executeJavaScript(`(()=>{
    if(location.origin!=='https://lexue.bit.edu.cn')return {state:'verification_required'};
    const signed=!!document.querySelector('a[href*="/login/logout.php"]')&&!document.body.classList.contains('notloggedin');
    const account=(document.querySelector('[data-userid]')?.getAttribute('data-userid')||document.querySelector('a[href*="/user/profile.php?id="]')?.getAttribute('href')?.match(/[?&]id=(\\d+)/)?.[1]||'');
    return {state:signed?'signed_in':'verification_required',account:signed?account:''};
  })()`).catch(()=>({state:'service_error'}));
  if(entry.disconnected)return;
  if(state.state==='signed_in'&&state.account)recordPlatformAccount('lexue',state.account);
  metadata.lexue={...metadata.lexue,auth:{state:state.state,checkedAt:new Date().toISOString(),message:state.state==='signed_in'?'乐学站点已确认登录，自动读取已选课程的作业、测验与编程练习。':'请完成乐学官方认证；统一认证有效时会自动返回。'}};persistMetadata();publish();
  if(state.state==='signed_in')scheduleLexueCollection(!wasSignedIn||metadata.lexue?.collection?.needsLogin);
}
function scheduleLexueCollection(force=false) {
  if(quitting||lexueDisconnecting||lexuePending||lexueTimer||!force&&Date.now()-lexueLastAttempt<5*60*1000)return;
  lexueTimer=setTimeout(()=>{lexueTimer=null;void collectLexue().catch(()=>{});},1200);lexueTimer.unref();
}
function readSummary(result) {
  const head = `已读取${result.courses}/${result.discovered}门课程`;
  return result.errors && result.errors.length
    ? `${head}，识别成功${result.assignments.length}项，失败${result.errors.length}项`
    : `${head}，全部识别成功`;
}
function collectLexue() {
  if(lexuePending)return lexuePending;
  if(quitting||lexueDisconnecting)return Promise.reject(new Error('乐学连接已断开'));
  clearTimeout(lexueTimer);lexueTimer=null;lexueLastAttempt=Date.now();
  const epoch=lexueEpoch,controller=new AbortController();lexueAbort=controller;
  const current=()=>!quitting&&!lexueDisconnecting&&epoch===lexueEpoch&&!controller.signal.aborted;
  const progress=collection=>{if(!current())return;metadata.lexue={...metadata.lexue,collection:{...collection,running:true,needsLogin:false},detail:collection.phase==='courses'?'正在自动读取乐学课程列表…':`正在读取作业、测验与编程练习：${collection.completed} / ${collection.total} 门课程`};publish();};
  lexuePending=(async()=>{
    const ses=await getPlatformSession('lexue');if(!current())throw new Error('采集已取消');
    const win=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}});lexueWorker=win;
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    for(const name of ['will-navigate','will-redirect'])win.webContents.on(name,(event,url)=>{if(!trusted(url,'lexue'))event.preventDefault();});
    const stop=()=>{if(!win.isDestroyed())win.destroy();};controller.signal.addEventListener('abort',stop,{once:true});
    // A term with many courses and sections legitimately takes longer than ten minutes at
    // the site's typical latency; completed courses are imported as they finish below.
    const timeout=setTimeout(()=>controller.abort(),30*60*1000);timeout.unref();
    try {
      const loadTimeout=setTimeout(stop,45000);
      try{await win.loadURL(lexueAssignments.LEXUE_ORIGIN+'/');if(await restorePageStorage(win,'lexue'))await win.loadURL(lexueAssignments.LEXUE_ORIGIN+'/');}catch{throw new Error('乐学官方页面暂时无法打开');}finally{clearTimeout(loadTimeout);}
      if(!current())throw new Error('采集已取消');
      const signedIn=()=>win.webContents.executeJavaScript(`location.origin==='https://lexue.bit.edu.cn'&&!document.body.classList.contains('notloggedin')&&!!document.querySelector('a[href*="/login/logout.php"]')`).catch(()=>false);
      let valid=await signedIn();let refreshError=null;
      if(!valid){
        metadata.lexue={...metadata.lexue,auth:{state:'renewing',checkedAt:new Date().toISOString(),message:'正在用保存的统一认证密码恢复乐学登录…'}};publish();
        try{
          if(await refreshLexueSession()){
            if(!current())throw new Error('采集已取消');
            try{await win.loadURL(lexueAssignments.LEXUE_ORIGIN+'/');}catch{}
            valid=await signedIn();
          }
        }catch(error){refreshError=error;if(error?.code==='bad_credentials')await noteCredentialFailure().catch(()=>{});}
      }
      if(!valid){
        const message=refreshError?.code==='bad_credentials'?'保存的密码无法登录乐学统一认证，请在“保存密码”中更新，或点击“重新登录”使用官方窗口。':'乐学会话已过期，请点击“重新登录”；登录后自动读取乐学课程。';
        throw Object.assign(new Error(message),{code:'login_required'});
      }
      metadata.lexue={...metadata.lexue,auth:{state:'signed_in',checkedAt:new Date().toISOString(),message:'乐学官方页面已确认登录，自动读取乐学课程。'}};
      const lexueAccount=await win.webContents.executeJavaScript(`(document.querySelector('[data-userid]')?.getAttribute('data-userid')||document.querySelector('a[href*="/user/profile.php?id="]')?.getAttribute('href')?.match(/[?&]id=(\\d+)/)?.[1]||'')`).catch(()=> '');
      if(!current())throw new Error('采集已取消');
      if(lexueAccount)recordPlatformAccount('lexue',lexueAccount);
      const result=await lexueAssignments.collectLexueAssignments({signal:controller.signal,onProgress:progress,
        onCourses:(rows,hiddenIds=[])=>{
          if(!current())throw new Error('采集已取消');
          const previous=new Map((coursePreferences.catalog.lexue||[]).map(course=>[String(course.id),course]));
          const hidden=new Set(hiddenIds.map(String));
          const flagged=rows.map(row=>({...row,hidden:hidden.has(String(row.id))}));
          const oldExcluded=coursePreferences.excluded.lexue||[];
          const excluded=oldExcluded.flatMap(key=>key.startsWith('name:')&&rows.some(c=>'name:'+c.title===key)?rows.filter(c=>'name:'+c.title===key).map(c=>c.id):[key]);
          // Hidden courses only enter the catalog by default; they stay unchecked until the
          // user selects them. A course already flagged hidden keeps the user's choice.
          for(const row of flagged){const id=String(row.id);if(row.hidden&&!previous.get(id)?.hidden&&!excluded.includes(id))excluded.push(id);}
          coursePreferences=coursePrefsModel.updateCourseCatalog({...coursePreferences,excluded:{...coursePreferences.excluded,lexue:excluded}},'lexue',flagged,true);persistMetadata();publish();
        },
        isCourseEnabled:(id,title)=>coursePrefsModel.courseEnabled(coursePreferences,'lexue',id)&&coursePrefsModel.courseEnabled(coursePreferences,'lexue','name:'+title),
        onCourse:(items)=>{
          if(!current())throw new Error('采集已取消');
          try{setTasks(model.importAssignments(tasks,accountRows('lexue',items),device),false);}
          catch(error){console.error('乐学单门课程保存失败：',error);}
        },
        request:async(path,params)=>{
          if(!current())throw new Error('采集已取消');
          const value=await win.webContents.executeJavaScript(`(${lexueAssignments.readLexueMetadata.toString()})(${JSON.stringify(path)},${JSON.stringify(params)})`);
          if(!current())throw new Error('采集已取消');return value;
        }});
      if(!current())throw new Error('采集已取消');
      await capture({id:'lexue',window:win,session:ses,get disconnected(){return !current();}});await sessionVaults.get('lexue')?.flush();
      if(!current())throw new Error('采集已取消');const saved=!!metadata.lexue?.saved;
      setTasks(model.importAssignments(tasks,accountRows('lexue',result.assignments),device),true);
      pruneLexueCourses(result.read || [], result.assignments);
      const message=readSummary(result);
      metadata.lexue={...metadata.lexue,saved,status:result.complete?'全部已读取':'部分已读取',count:result.assignments.length,lastScan:new Date().toISOString(),detail:message,collection:{running:false,needsLogin:false,discovered:result.discovered,total:result.courses,skipped:result.skipped,completed:result.completed,failures:result.errors.length,unknown:result.unknown}};
      persistMetadata();publish();return{assignments:accountRows('lexue',result.assignments),message};
    }finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',stop);stop();if(lexueWorker===win)lexueWorker=null;}
  })().catch(error=>{
    if(current()){
      const needsLogin=error.code==='login_required';
      metadata.lexue={...metadata.lexue,collection:{...metadata.lexue?.collection,running:false,needsLogin},detail:needsLogin?error.message:'乐学自动读取未完成，已有事项保留，请稍后刷新。'};
      if(needsLogin)metadata.lexue.auth={state:'verification_required',message:error.message,checkedAt:new Date().toISOString()};
      persistMetadata();publish();
    }
    throw error;
  }).finally(()=>{
    if(epoch===lexueEpoch&&controller.signal.aborted&&!quitting&&!lexueDisconnecting&&controller.signal.reason!=='course_selection_changed'){
      metadata.lexue={...metadata.lexue,collection:{...metadata.lexue?.collection,running:false},detail:'乐学自动读取超时，请稍后刷新。已有事项保留。'};persistMetadata();publish();
    }
    lexuePending=null;if(lexueAbort===controller)lexueAbort=null;
  });return lexuePending;
}
function scheduleMoocCollection(force=false) {
  if(quitting||moocDisconnecting||moocPending||moocTimer||!force&&Date.now()-moocLastAttempt<5*60*1000)return;
  moocTimer=setTimeout(()=>{moocTimer=null;void collectMooc().catch(()=>{});},1200);moocTimer.unref();
}
function collectMooc() {
  if(moocPending)return moocPending;
  if(quitting||moocDisconnecting)return Promise.reject(new Error('MOOC 连接已断开'));
  clearTimeout(moocTimer);moocTimer=null;moocLastAttempt=Date.now();
  const epoch=moocEpoch,controller=new AbortController();moocAbort=controller;
  const current=()=>!quitting&&!moocDisconnecting&&epoch===moocEpoch&&!controller.signal.aborted;
  const progress=collection=>{if(!current())return;metadata.mooc={...metadata.mooc,collection:{...collection,running:true,needsLogin:false},detail:collection.phase==='courses'?'正在自动读取 SPOC 课程列表…':`正在读取测验与作业：${collection.completed} / ${collection.total} 门课程`};publish();};
  moocPending=(async()=>{
    const ses=await getPlatformSession('mooc');if(!current())throw new Error('采集已取消');
    const win=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}});moocWorker=win;
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    for(const name of ['will-navigate','will-redirect'])win.webContents.on(name,(event,url)=>{if(!trusted(url,'mooc'))event.preventDefault();});
    const stop=()=>{if(!win.isDestroyed())win.destroy();};controller.signal.addEventListener('abort',stop,{once:true});
    const timeout=setTimeout(()=>controller.abort(),10*60*1000);timeout.unref();
    try {
      const loadTimeout=setTimeout(stop,45000);
      try{await win.loadURL(moocAssignments.MOOC_ORIGIN+'/');if(await restorePageStorage(win,'mooc'))await win.loadURL(moocAssignments.MOOC_ORIGIN+'/');}catch{throw new Error('MOOC 官方页面暂时无法打开');}finally{clearTimeout(loadTimeout);}
      if(!current())throw new Error('采集已取消');
      const valid=await win.webContents.executeJavaScript(`(async()=>{for(let i=0;i<20;i++){if(location.origin==='https://www.icourse163.org'&&window.webUser?.id)return String(window.webUser.id);await new Promise(r=>setTimeout(r,250));}return '';})()`);
      if(!valid)throw Object.assign(new Error('MOOC 会话已过期，请点击“重新登录”；登录后自动读取 SPOC 课程。'),{code:'login_required'});
      recordPlatformAccount('mooc',valid);
      metadata.mooc={...metadata.mooc,auth:{state:'signed_in',checkedAt:new Date().toISOString(),message:'MOOC 官方页面已确认登录，自动读取 SPOC 课程。'}};
      const result=await moocAssignments.collectMoocAssignments({signal:controller.signal,onProgress:progress,
        onCourses:rows=>{if(!current())throw new Error('采集已取消');coursePreferences=coursePrefsModel.updateCourseCatalog(coursePreferences,'mooc',rows,true);persistMetadata();publish();},
        isCourseEnabled:id=>coursePrefsModel.courseEnabled(coursePreferences,'mooc',id),
        request:async(path,params)=>{
          if(!current())throw new Error('采集已取消');
          const value=await win.webContents.executeJavaScript(`(${moocAssignments.readMoocList.toString()})(${JSON.stringify(path)},${JSON.stringify(params)})`);
          if(!current())throw new Error('采集已取消');return value;
        }});
      if(!current())throw new Error('采集已取消');
      await capture({id:'mooc',window:win,session:ses,get disconnected(){return !current();}});await sessionVaults.get('mooc')?.flush();
      if(!current())throw new Error('采集已取消');const saved=!!metadata.mooc?.saved;
      setTasks(model.importAssignments(tasks,accountRows('mooc',result.assignments),device),true);
      const message=readSummary(result);
      metadata.mooc={...metadata.mooc,saved,status:result.complete?'全部已读取':'部分已读取',count:result.assignments.length,lastScan:new Date().toISOString(),detail:message,collection:{running:false,needsLogin:false,discovered:result.discovered,total:result.courses,skipped:result.skipped,completed:result.completed,failures:result.errors.length}};
      persistMetadata();publish();return{assignments:accountRows('mooc',result.assignments),message};
    }finally{clearTimeout(timeout);controller.signal.removeEventListener('abort',stop);stop();if(moocWorker===win)moocWorker=null;}
  })().catch(error=>{
    if(current()){
      const needsLogin=error.code==='login_required';
      metadata.mooc={...metadata.mooc,collection:{...metadata.mooc?.collection,running:false,needsLogin},detail:needsLogin?error.message:'MOOC 自动读取未完成，已有事项保留，请稍后刷新。'};
      if(needsLogin)metadata.mooc.auth={state:'verification_required',message:error.message,checkedAt:new Date().toISOString()};
      persistMetadata();publish();
    }
    throw error;
  }).finally(()=>{
    if(epoch===moocEpoch&&controller.signal.aborted&&!quitting&&!moocDisconnecting&&controller.signal.reason!=='course_selection_changed'){
      metadata.mooc={...metadata.mooc,collection:{...metadata.mooc?.collection,running:false},detail:'MOOC 自动读取超时，请稍后刷新。已有事项保留。'};persistMetadata();publish();
    }
    moocPending=null;if(moocAbort===controller)moocAbort=null;
  });return moocPending;
}
function scheduleYanheCollection(force = false) {
  if (quitting || yanheDisconnecting || metadata.yanhe?.auth?.state !== 'signed_in' || yanheCollectPending || yanheCollectTimer || !force && Date.now() - yanheLastCollectAttempt < 5 * 60 * 1000) return;
  yanheCollectTimer = setTimeout(() => {yanheCollectTimer = null;void collectYanhe().catch(() => {});}, 1200);
  yanheCollectTimer.unref();
}
function collectYanhe() {
  if (yanheCollectPending) return yanheCollectPending;
  if (quitting || yanheDisconnecting) return Promise.reject(new Error('延河连接已断开'));
  clearTimeout(yanheCollectTimer);yanheCollectTimer = null;
  const epoch = yanheEpoch;
  const controller = new AbortController();yanheCollectAbort = controller;yanheLastCollectAttempt = Date.now();
  const current = () => !quitting && !yanheDisconnecting && epoch === yanheEpoch && !controller.signal.aborted;
  const progress = collection => {
    if (!current()) return;
    const detail = collection.phase === 'courses' ? '正在自动读取课程列表…' : `正在自动读取作业与测试：${collection.completed} / ${collection.total} 门课程`;
    metadata.yanhe = {...metadata.yanhe, collection: {...collection, running: true, needsLogin: false}, detail};publish();
  };
  yanheCollectPending = (async () => {
    const auth = await checkYanhe();if (!current()) throw new Error('采集已取消');
    if (auth.state !== 'signed_in') throw new Error(auth.message);
    progress({phase: 'courses', total: 0, completed: 0});
    const ses = await getPlatformSession('yanhe');if (!current()) throw new Error('采集已取消');
    const win = new BrowserWindow({show: false, webPreferences: {session: ses, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true}});
    yanheWorker = win;
    ses.setPermissionRequestHandler((_, __, cb) => cb(false));
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', (event, url) => {if (!trusted(url, 'yanhe')) event.preventDefault();});
    win.webContents.on('will-redirect', (event, url) => {if (!trusted(url, 'yanhe')) event.preventDefault();});
    const stop = () => {if (!win.isDestroyed()) win.destroy();};controller.signal.addEventListener('abort', stop, {once: true});
    const roundTimeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);roundTimeout.unref();
    try {
      const loadTimeout = setTimeout(stop, 45000);
      try {await win.loadURL(yanheAssignments.ECLASS_ORIGIN + '/');} catch {throw new Error('课后任务站点暂时未能打开，请检查网络后刷新');} finally {clearTimeout(loadTimeout);}
      if (!current()) throw new Error('采集已取消');
      const location = new URL(win.webContents.getURL());
      if (location.origin !== yanheAssignments.ECLASS_ORIGIN || /\/auth\/|\/login/.test(location.pathname) || await win.webContents.executeJavaScript('!!document.querySelector("input[type=password]")')) {
        const error = new Error('课后任务需要官方身份验证，请点击“重新登录”；完成后将自动读取全部课程');error.code = 'login_required';throw error;
      }
      const result = await yanheAssignments.collectYanheAssignments({signal: controller.signal, onProgress: progress,
        onCourses: rows => {if (!current()) throw new Error('采集已取消');coursePreferences = coursePrefsModel.updateCourseCatalog(coursePreferences, 'yanhe', rows, true);persistMetadata();publish();},
        isCourseEnabled: id => coursePrefsModel.courseEnabled(coursePreferences, 'yanhe', id),
        request: async (path, options) => {
          if (!current()) throw new Error('采集已取消');
          const input = {method: options.method, params: options.params};
          const value = await win.webContents.executeJavaScript(`(${yanheAssignments.readEclassList.toString()})(${JSON.stringify(path)},${JSON.stringify(input)})`);
          if (!current()) throw new Error('采集已取消');
          if (value?.failure) {const error = new Error('平台查询未能完成');error.code = value.failure;throw error;}
          return value;
        }});
      if (!current()) throw new Error('采集已取消');
      const cookies = (await ses.cookies.get({})).filter(c => trusted(`https://${c.domain.replace(/^\./, '')}/`, 'yanhe'));
      if (!current()) throw new Error('采集已取消');
      secrets.platforms.yanhe = {...secrets.platforms.yanhe, cookies};saveSecrets();
      setTasks(model.importAssignments(tasks, accountRows('yanhe', result.assignments), device), true);
      const message = readSummary(result);
      metadata.yanhe = {...metadata.yanhe, status: result.complete ? '全部已读取' : '部分已读取', count: result.assignments.length, lastScan: new Date().toISOString(), detail: message,
        collection: {running: false, needsLogin: false, total: result.courses, discovered: result.discovered, skipped: result.skipped, completed: result.completed, failures: result.errors.length}};
      persistMetadata();publish();return {assignments: accountRows('yanhe', result.assignments), message};
    } finally {clearTimeout(roundTimeout);controller.signal.removeEventListener('abort', stop);stop();if (yanheWorker === win) yanheWorker = null;}
  })().catch(error => {
    if (current()) {
      const needsLogin = error.code === 'login_required';
      metadata.yanhe = {...metadata.yanhe, collection: {...metadata.yanhe?.collection, running: false, needsLogin}, detail: needsLogin ? error.message : '自动读取未完成，已有事项保留。请稍后刷新；无需逐门打开课程。'};
      persistMetadata();publish();
    }
    throw error;
  }).finally(() => {
    if (epoch === yanheEpoch && controller.signal.aborted && !yanheDisconnecting && !quitting && controller.signal.reason !== 'course_selection_changed') {
      metadata.yanhe = {...metadata.yanhe, collection: {...metadata.yanhe?.collection, running: false}, detail: '自动读取超时，已有事项保留，请稍后刷新。'};persistMetadata();publish();
    }
    yanheCollectPending = null;if (yanheCollectAbort === controller) yanheCollectAbort = null;
  });
  return yanheCollectPending;
}
let mainRendererReady = false, mainLoading;
async function createMainWindow() {
  mainRendererReady = false;
  const win = new BrowserWindow({width: 1360, height: 930, minWidth: 850, minHeight: 680,
    titleBarStyle: 'hidden',titleBarOverlay: nativeCaptionColors(),
    ...(process.platform==='win32'?{backgroundMaterial:'mica',backgroundColor:'#00000000'}:{backgroundColor:'#f7f8fa'}),
    title: '归序 · DDL 收纳', icon: APP_ICON, show: false,
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true}});
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));win.webContents.on('will-navigate', event => event.preventDefault());
  const updateWindowTheme=()=>{if(win.isDestroyed())return;win.setTitleBarOverlay(nativeCaptionColors());void win.webContents.executeJavaScript(`document.documentElement.dataset.nativeTheme='${nativeTheme.shouldUseDarkColors?'dark':'light'}'`).catch(()=>{});};
  nativeTheme.on('updated',updateWindowTheme);win.webContents.on('did-finish-load',updateWindowTheme);
  win.once('closed',()=>nativeTheme.removeListener('updated',updateWindowTheme));
  Menu.setApplicationMenu(null);
  await win.loadFile(path.join(__dirname, '../dist/index.html'));win.show();
  if (process.connected) process.send({type: 'desktop:ready'});
  win.on('close', event => {
    if (quitting) return;
    if (widget?.settings.enabled) return;
    event.preventDefault();
    Promise.all([...windows.values()].map(entry => capture(entry).catch(() => {}))).then(()=>Promise.all([...sessionVaults.values()].map(v=>v.capture().catch(()=>{})))).finally(() => app.quit());
  });
  win.on('closed', () => {
    if (mainWindow === win) {mainWindow = null;mainRendererReady = false;}
    if (quitting) return;
    if (widget?.settings.enabled) widget.publish(scopedSnapshot(), true);
    else app.quit();
  });
}
async function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!mainLoading) mainLoading = createMainWindow().finally(() => {mainLoading = null;});
    await mainLoading;
  } else if (mainLoading) await mainLoading;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();mainWindow.focus();publish();
}
function trayWidgetLabel() {return widget?.settings.enabled ? '隐藏小组件' : '显示小组件';}
function openNewTaskFromTray() {
  pendingNewTask = true;
  void showMainWindow().then(() => {
    if (pendingNewTask && mainRendererReady && mainWindow && !mainWindow.isDestroyed()) {
      pendingNewTask = false;mainWindow.webContents.send('task:new');
    }
  }).catch(() => {});
}
function showTasksFromTray() {void showMainWindow().catch(() => {});}
function toggleWidgetFromTray() {
  if (!widget) return;
  try {widget.configure({enabled: !widget.settings.enabled});refreshTrayMenu();}
  catch (error) {console.error('切换桌面小组件失败：', error);}
}
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: '新建待办', click: openNewTaskFromTray},
    {label: '查看待办', click: showTasksFromTray},
    {label: trayWidgetLabel(), click: toggleWidgetFromTray},
    {type: 'separator'},
    {label: '退出归序', click: () => {quitting = true;app.quit();}}
  ]));
}
function createTray() {
  if (tray) return;
  try {
    tray = new Tray(APP_ICON);tray.setToolTip('归序 · DDL 收纳');tray.on('click', showTasksFromTray);refreshTrayMenu();
    if (!app.isPackaged) globalThis.__duefoldTray = {get exists() {return !!tray && !tray.isDestroyed();}, actions: {newTask: openNewTaskFromTray, view: showTasksFromTray, toggleWidget: toggleWidgetFromTray}};
  } catch (error) {console.error('无法创建托盘图标：', error);tray = null;}
}
async function boot() {
  model = await import('../shared/model.mjs');storage = await import('../shared/storage.mjs');parsers = await import('./platform-parser.mjs');
  yanheAuthModule = await import('./yanhe-auth.mjs');
  yanheAssignments = await import('./yanhe-assignments.mjs');
  moocAssignments = await import('./mooc-assignments.mjs');
  lexueAssignments = await import('./lexue-assignments.mjs');
  coursePrefsModel = await import('../shared/course-preferences.mjs');
  const {SyncController} = await import('./sync/index.mjs');
  syncConfig = await import('./sync/config.mjs');
  const data = storage.readJSON(file('settings.json'), {});device = data.device || randomUUID();metadata = data.metadata || {};config = syncConfig.normalizeSyncConfig(data.config);
  const savedSyncState = data.syncState?.supabase;
  if (savedSyncState && typeof savedSyncState.projectUrl === 'string' && typeof savedSyncState.userId === 'string' && typeof savedSyncState.ownerId === 'string' && typeof savedSyncState.lastServerTime === 'string' && Number.isFinite(Date.parse(savedSyncState.lastServerTime))) syncState = {supabase: {projectUrl: savedSyncState.projectUrl, userId: savedSyncState.userId, ownerId: savedSyncState.ownerId, lastServerTime: savedSyncState.lastServerTime}};
  themeMode=['system','light','dark'].includes(data.themeMode)?data.themeMode:'system';nativeTheme.themeSource=themeMode;
  coursePreferences = coursePrefsModel.validateCoursePreferences(data.coursePreferences || {});accounts = validAccounts(data.accounts);
  tasks = model.validateTasks(storage.readJSON(file('tasks.json'), []));
  if (canEncrypt() && fs.existsSync(file('vault.json'))) {try {secrets = JSON.parse(safeStorage.decryptString(Buffer.from(storage.readJSON(file('vault.json'), {}).encrypted, 'base64')));} catch {for (const id of platformIDs) metadata[id] = {saved: false, detail: '加密会话无法解密，请重新登录。'};config.enabled = false;}}
  campusSso = new CampusSso(secrets.campusCookies ?? [...(secrets.platforms.lexue?.cookies || []),...(secrets.platforms.yanhe?.cookies || [])], cookies => {secrets.campusCookies = cookies;saveSecrets();});
  secrets.campusCookies=[...campusSso.cookies.values()];saveSecrets();
  if (metadata.yanhe) metadata.yanhe = {...metadata.yanhe, collection: {...metadata.yanhe.collection, running: false}, auth: {state: 'none', message: '已恢复本机凭据，尚未完成本次登录核验。'}};
  if(metadata.mooc)metadata.mooc={...metadata.mooc,collection:{...metadata.mooc.collection,running:false},auth:{state:'none',message:'正在核验已保存的 MOOC 会话。'}};
  if(metadata.lexue)metadata.lexue={...metadata.lexue,collection:{...metadata.lexue.collection,running:false},auth:{state:'none',message:'乐学站点尚未核验，可复用北理工认证。'}};
  sync = new SyncController({getTasks: () => tasks, merge: incoming => setTasks(incoming), status: value => {syncStatus = value;publish();},
    readSession: () => secrets.supabaseSession || null,
    writeSession: value => {
      if (!canEncrypt()) throw new Error('系统安全存储暂不可用');
      const previous = secrets.supabaseSession;secrets.supabaseSession = value;
      try {if (!saveSecrets()) throw new Error('系统安全存储暂不可用');} catch (error) {if (previous) secrets.supabaseSession = previous;else delete secrets.supabaseSession;throw error;}
      publish();
    },
    readState: () => syncState.supabase || null,
    writeState: value => {syncState = {supabase: value};persistMetadata();},
    identity: value => {supabaseIdentity = value;publish();}
  });
  wireIPC();persistMetadata();
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({responseHeaders: {...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"]}}));
  widget = new DesktopWidget({BrowserWindow, screen, storage, file: file('widget.json'), snapshot: scopedSnapshot, model, taskCourseEnabled: coursePrefsModel.taskCourseEnabled,
    onChange: publish, onHide: () => {if (!mainWindow || mainWindow.isDestroyed()) app.quit();}});
  await createMainWindow();widget.start();createTray();
  if (secrets.platforms.yanhe) void checkYanhe().catch(() => {});
  if(secrets.platforms.mooc)scheduleMoocCollection(true);
  if(secrets.platforms.lexue)scheduleLexueCollection(true);
  const lexueInterval=setInterval(()=>{if(secrets.platforms.lexue)scheduleLexueCollection();},5*60*1000);lexueInterval.unref();
  const moocInterval=setInterval(()=>{if(secrets.platforms.mooc)scheduleMoocCollection();},5*60*1000);moocInterval.unref();
  const authTimer = setInterval(() => {if (!quitting && secrets.platforms.yanhe) void checkYanhe().catch(() => {});}, 5 * 60 * 1000);authTimer.unref();
  const autoScan = setInterval(async () => {
    for (const [id, entry] of windows) {
      if (id==='lexue'||quitting || entry.window.isDestroyed() || entry.scanning) continue;
      entry.scanning = true;
      try {
        await capture(entry);
        const result = await scanPlatform(id, false);
        if (result.assignments.length) setTasks(model.importAssignments(tasks, accountRows(id, result.assignments), device), true);
      } catch {} finally {entry.scanning = false;}
    }
  }, 5 * 60 * 1000);
  autoScan.unref();
  if (config.enabled && config.provider === 'supabase' && !canEncrypt()) {syncStatus = '系统安全存储暂不可用，无法恢复云端登录';publish();}
  else if (!config.enabled || config.provider === 'supabase' || secrets.syncToken) sync.configure(config, {syncToken: secrets.syncToken});
}
const lock = app.requestSingleInstanceLock();
if (!lock) {
  if (process.connected) process.send({type: 'desktop:handoff'}, () => app.quit());
  else app.quit();
}
else {
  const bootPromise = app.whenReady().then(boot);
  app.on('second-instance', (_event,argv) => {
    void (async()=>{
      await bootPromise;
      await showMainWindow();
      // Source review must display the rebuilt renderer, including when a
      // previous window remains alive behind the desktop widget/tray.
      if(!app.isPackaged&&argv.includes('--review')&&mainWindow&&!mainWindow.isDestroyed()){
        mainRendererReady=false;
        await mainWindow.loadFile(path.join(__dirname,'../dist/index.html'));
      }
    })().catch(error=>console.error('无法刷新源码审查界面：',error));
  });
  bootPromise.catch(async e => {console.error(`归序启动失败：${e.message}`);await dialog.showMessageBox({type: 'error', title: '归序启动失败', message: '为保护本地数据，程序已停止启动。', detail: `${e.message}\n数据目录：${app.getPath('userData')}`});app.exit(1);});
  app.on('before-quit', () => {quitting = true;tray?.destroy();tray = null;widget?.dispose();clearTimeout(authExpiryTimer);clearTimeout(yanheCollectTimer);yanheCollectAbort?.abort();clearTimeout(moocTimer);moocAbort?.abort();clearTimeout(lexueTimer);lexueAbort?.abort();void yanheAuth?.dispose();sync?.close();});
  app.on('window-all-closed', () => app.quit());
  app.on('browser-window-created', (_, win) => {win.setIcon(APP_ICON);win.webContents.on('will-attach-webview', event => event.preventDefault());});
}
