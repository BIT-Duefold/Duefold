import {validateHomeworkProgress,taskSourceState,taskDueAt} from './homework-progress.mjs';
import {validateProgrammingInfo} from './programming-info.mjs';
export {taskSourceState,taskSourceLabel,taskDueAt} from './homework-progress.mjs';
export const PLATFORMS = {
  manual: { name: '手动添加', color: 'var(--text-secondary)', short: '自', url: '' },
  yanhe: { name: '延河课堂', color: 'var(--accent)', short: '延', url: 'https://aita.yanhekt.cn/course' },
  lexue: { name: '乐学', color: 'var(--info)', short: '乐', url: 'https://lexue.bit.edu.cn/' },
  mooc: { name: '中国大学 MOOC', color: 'var(--warning)', short: '慕', url: 'https://www.icourse163.org/' },
  zhihuishu: { name: '智慧树', color: 'var(--purple)', short: '知', url: 'https://www.zhihuishu.com/' }
};
export const MAX_TASKS = 10000;
export const SOURCE_STATES = ['unknown', 'unsubmitted', 'draft', 'submitted', 'returned','awaiting_review','review_required','expired'];
export function validateScore(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('成绩格式不正确');
  const earned = Number(value.earned), total = Number(value.total);
  if (!Number.isFinite(earned) || !Number.isFinite(total) || earned < 0 || total <= 0 || earned > 100000 || total > 100000) throw new Error('成绩格式不正确');
  return {earned, total};
}
export function scoreTag(score) {
  if (!score) return '';
  const format = value => String(Number(value.toFixed(4)));
  return `${format(score.earned)}/${format(score.total)}`;
}
// Removes records from the active list while keeping tombstones for synchronization.
export function archiveTasks(tasks, ids, device) {
  const set = new Set(ids), targets = tasks.filter(t => set.has(t.id) && !t.deleted);
  if (!targets.length) return tasks;
  let clock = Math.max(0, ...tasks.map(t => t.version.clock));
  const now = new Date().toISOString();
  return mergeTasks(tasks, targets.map(t => validateTask({...t, deleted: true, deletedAt: now, autoArchived: true, version: {clock: ++clock, device}, updatedAt: now})));
}
export function isTaskDone(task) {return task.ignored || task.completed || taskSourceState(task) === 'submitted';}
// Platform tasks carry the account that produced them. A task without an account is
// legacy or manual and stays visible; otherwise only the platform's active account shows.
export function taskAccountVisible(task, accounts = {}) {
  if (!task?.sourceAccount) return true;
  const active = accounts?.[task.platform];
  return !active || task.sourceAccount === active;
}
export function importSource(task) {
  const prefix = `import:${task?.platform}:`;
  if (typeof task?.id !== 'string' || !task.id.startsWith(prefix)) return '';
  let source = '';try {source = decodeURIComponent(task.id.slice(prefix.length));} catch {return '';}
  return source.replace(/^[^|]*\|/, '');
}
// Moving to a scoped identity keeps the per-account record and tombstones the legacy
// unscoped one, so a refresh cannot resurrect the old duplicate.
export function scopeTasksToAccount(tasks, platform, account, device) {
  if (!account) return tasks;
  const legacy = tasks.filter(t => t.platform === platform && !t.sourceAccount && !t.deleted);
  if (!legacy.length) return tasks;
  let clock = Math.max(0, ...tasks.map(t => t.version.clock));
  const now = new Date().toISOString(), existing = new Set(tasks.map(t => t.id));
  const created = [], stale = [];
  for (const task of legacy) {
    const source = importSource(task);if (!source) continue;
    const nextId = importIdentity(platform, `${account}|${source}`);
    if (!existing.has(nextId)) {
      existing.add(nextId);
      created.push(validateTask({...task, id: nextId, sourceAccount: account, deleted: false, deletedAt: null, version: {clock: ++clock, device}, updatedAt: now}));
    }
    stale.push(task);
  }
  if (!stale.length) return tasks;
  const tombstones = stale.map(task => validateTask({...task, deleted: true, deletedAt: now, version: {clock: ++clock, device}, updatedAt: now}));
  return mergeTasks(tasks, [...created, ...tombstones]);
}
export function taskDisplayTitle(task) {
  const course = task.course?.trim();
  return !course || task.title.startsWith(course + '-') ? task.title : `${course}-${task.title}`;
}
export function isTaskOverdue(task, now = Date.now()) {
  const state=taskSourceState(task,now),due=taskDueAt(task,now);
  return !task.ignored && !task.completed && state!=='submitted' && (state==='expired'||!!due&&Date.parse(due)<now&&(task.platform==='manual'||['unsubmitted','draft','returned','review_required'].includes(state)));
}
/** @param {string | number | Date} [value] */
export function dayKey(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseDeadline(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value < 1e12 ? value * 1000 : value);
    if (!Number.isNaN(+d)) return d.toISOString();
  }
  if (typeof value !== 'string') throw new Error('截止日期必须是日期字符串或时间戳');
  let s = value.trim().replace(/年|\//g, '-').replace('月', '-').replace('日', '').replace(/截止[：:]?\s*/, '');
  s = s.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/, (_, y, m, d, rest) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}${rest}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T23:59:00+08:00';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    s = s.replace(' ', 'T').replace(/T(\d):/, 'T0$1:');
    s += '+08:00';
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) throw new Error(`无法识别截止日期：${value}`);
  const parts = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const [, y, m, d, h, minute] = parts;
  const lastDay = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
  if (+m < 1 || +m > 12 || +d < 1 || +d > lastDay || +h > 23 || +minute > 59 || Number.isNaN(Date.parse(s))) throw new Error(`无效截止日期：${value}`);
  return new Date(s).toISOString();
}
function str(v, max, field, required = false) {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw new Error(`${field}格式不正确`);
  return v;
}
export function safeSourceURL(value) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('来源链接必须是不含账号密码的 HTTPS 地址');
  const allowed = new Set(['id', 'courseid', 'cmid', 'assignmentid', 'homeworkid', 'examid', 'quizid', 'r', 'tenant_code', 'tid']);
  for (const key of [...url.searchParams.keys()]) if (!allowed.has(key.toLowerCase())) url.searchParams.delete(key);
  if (!(url.hostname === 'www.icourse163.org' && /^\/spoc\/learn\/[^/]+$/.test(url.pathname) && (url.hash === '#/learn/testlist'||/^#\/learn\/hw\?id=\d{1,16}$/.test(url.hash)))) url.hash = '';return url.toString();
}
export function validateTask(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('任务格式不正确');
  str(t.id, 1400, '任务 ID', true); str(t.title, 500, '标题', true);
  str(t.course, 200, '课程'); str(t.notes, 10000, '备注'); str(t.sourceUrl, 3000, '来源链接');
  if (!Object.hasOwn(PLATFORMS, t.platform)) throw new Error('未知任务平台');
  if (t.sourceUrl && !/^https:\/\//i.test(t.sourceUrl)) throw new Error('来源链接必须是 HTTPS');
  if (typeof t.completed !== 'boolean' || typeof t.deleted !== 'boolean') throw new Error('任务状态不正确');
  if(t.ignored!==undefined&&typeof t.ignored!=='boolean')throw new Error('忽略状态格式不正确');
  const ignored=t.ignored??false,deletedAt=t.deleted?(t.deletedAt??t.updatedAt):null;
  if(deletedAt!==null&&(typeof deletedAt!=='string'||!Number.isFinite(Date.parse(deletedAt))))throw new Error('回收站日期格式不正确');
  const sourceState = t.sourceState ?? 'unknown', sourceKind = t.sourceKind ?? '';
  if (!SOURCE_STATES.includes(sourceState) || !['', 'homework', 'exam'].includes(sourceKind)) throw new Error('平台提交状态格式不正确');
  const sourceCheckedAt = t.sourceCheckedAt ?? null;
  const sourceAccount = t.sourceAccount == null ? '' : t.sourceAccount;
  if (typeof sourceAccount !== 'string' || sourceAccount.length > 100) throw new Error('平台账号标识格式不正确');
  const autoArchived = t.autoArchived === true;
  const score = validateScore(t.score);
  const homeworkProgress=validateHomeworkProgress(t.homeworkProgress);
  const programmingInfo=validateProgrammingInfo(t.programmingInfo);
  if(programmingInfo&&(t.platform!=='lexue'||sourceKind!=='homework'))throw new Error('编程练习信息仅用于乐学编程作业');
  if(homeworkProgress&&(t.platform!=='mooc'||sourceKind!=='homework'))throw new Error('作业阶段仅用于 MOOC 作业');
  if (sourceCheckedAt !== null && (typeof sourceCheckedAt !== 'string' || Number.isNaN(Date.parse(sourceCheckedAt)))) throw new Error('平台状态时间格式不正确');
  if (t.dueAt !== null && (typeof t.dueAt !== 'string' || parseDeadline(t.dueAt) !== t.dueAt)) throw new Error('截止日期须为标准 ISO 格式');
  if (!t.version || !Number.isSafeInteger(t.version.clock) || t.version.clock < 0 || t.version.clock >= Number.MAX_SAFE_INTEGER - MAX_TASKS) throw new Error('任务版本不正确');
  str(t.version.device, 100, '设备标识', true);
  for (const f of ['createdAt', 'updatedAt']) if (typeof t[f] !== 'string' || Number.isNaN(Date.parse(t[f]))) throw new Error('记录时间不正确');
  // Only these fields can cross the sync boundary. Credentials cannot hitchhike on records.
  return { id: t.id, title: t.title.trim(), course: t.course, notes: t.notes, sourceUrl: safeSourceURL(t.sourceUrl),
    platform: t.platform, dueAt: t.dueAt, completed: t.completed, deleted: t.deleted, ignored,deletedAt,sourceState, sourceKind, sourceCheckedAt,homeworkProgress,programmingInfo,...(sourceAccount?{sourceAccount}:{}),...(score?{score}:{}),...(autoArchived?{autoArchived:true}:{}),
    version: { clock: t.version.clock, device: t.version.device }, createdAt: t.createdAt, updatedAt: t.updatedAt };
}
export function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > MAX_TASKS) throw new Error('任务列表过大或格式不正确（最多 10000 项）');
  const records = tasks.map(validateTask);
  if (new Set(records.map(t => t.id)).size !== records.length) throw new Error('任务列表包含重复 ID');
  if (new TextEncoder().encode(JSON.stringify(records)).length > 7 * 1024 * 1024) throw new Error('任务数据超过 7 MB，请导出归档后重试');
  return records;
}
export function compareVersions(a, b) {
  return a.clock - b.clock || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0);
}
export function mergeTasks(local, incoming) {
  const map = new Map(local.map(t => [t.id, t]));
  for (const t of validateTasks(incoming)) {
    const old = map.get(t.id);
    if (!old || compareVersions(t.version, old.version) > 0) map.set(t.id, t);
    else if (compareVersions(t.version, old.version) === 0 && JSON.stringify(t) !== JSON.stringify(old)) {
      // Deterministic tie handling for corrupt/imported records with reused versions.
      map.set(t.id, JSON.stringify(t) > JSON.stringify(old) ? t : old);
    }
  }
  if (map.size > MAX_TASKS) throw new Error('超过任务容量，请先导出归档');
  return [...map.values()];
}
export function mutateTask(tasks, patch, device) {
  const prev = tasks.find(t => t.id === patch.id);
  const clock = Math.max(0, ...tasks.map(t => t.version.clock)) + 1;
  const now = new Date().toISOString();
  const next = validateTask({ id: crypto.randomUUID(), title: '', course: '', notes: '', platform: 'manual', sourceUrl: '', dueAt: null,
    completed: false, deleted: false, createdAt: now, ...prev, ...patch,...(patch.deleted===true&&!prev?.deleted?{deletedAt:now}:{}), updatedAt: now, version: { clock, device } });
  return mergeTasks(tasks, [next]);
}
export function importIdentity(platform, sourceId) {
  return `import:${platform}:${encodeURIComponent(String(sourceId)).slice(0, 1300)}`;
}
export function importAssignments(tasks, assignments, device) {
  let result = [...tasks];
  if (!Array.isArray(assignments) || assignments.length > MAX_TASKS) throw new Error('导入列表格式或数量不正确');
  // Validate the full batch before touching the caller's state.
  const normalized = assignments.map(a => {
    if (!a || typeof a.title !== 'string' || !a.title.trim()) throw new Error('导入任务缺少标题');
    const platform = a.platform || 'manual';
    const dueAt = parseDeadline(a.dueAt);
    const account = a.sourceAccount == null ? '' : a.sourceAccount;
    if (typeof account !== 'string' || account.length > 100) throw new Error('平台账号标识格式不正确');
    let key = a.sourceId || a.id || `${a.course || ''}|${a.title}|${dueAt || ''}`;
    if (typeof key === 'string' && /^https:\/\//i.test(key)) key = safeSourceURL(key);
    const result = { id: importIdentity(platform, account ? `${account}|${key}` : key), title: a.title, course: a.course || '', notes: a.notes || '', platform,
      sourceUrl: safeSourceURL(a.sourceUrl || ''), dueAt };
    if (account) result.sourceAccount = account;
    if (a.sourceState !== undefined) {
      if (!SOURCE_STATES.includes(a.sourceState)) throw new Error('平台提交状态格式不正确');
      result.sourceState = a.sourceState;
    }
    if (a.sourceKind !== undefined) {if (!['homework','exam'].includes(a.sourceKind)) throw new Error('平台任务类型格式不正确');result.sourceKind = a.sourceKind;}
    if (a.ignored !== undefined) {if (typeof a.ignored !== 'boolean') throw new Error('忽略状态格式不正确');result.ignored = a.ignored;}
    if (a.score !== undefined) result.score = validateScore(a.score);
    if(a.homeworkProgress!==undefined)result.homeworkProgress=validateHomeworkProgress(a.homeworkProgress);
    if(a.programmingInfo!==undefined)result.programmingInfo=validateProgrammingInfo(a.programmingInfo);
    return result;
  });
  for (const patch of normalized) {
    let old = result.find(t => t.id === patch.id);
    const patchSource = importSource(patch);
    // Upgrade a unique old calendar/page item by its exact activity URL, keeping user edits.
    if(!old&&patch.platform==='lexue'&&patchSource.startsWith('moodle:')) {
      const matches=result.filter(t=>t.platform==='lexue'&&!importSource(t).startsWith('moodle:')&&t.sourceUrl&&safeSourceURL(t.sourceUrl)===patch.sourceUrl);
      if(matches.length===1) {
        const previous=matches[0];
        result=mutateTask(result,{...previous,...patch,notes:previous.notes,completed:previous.completed,deleted:previous.deleted,ignored:previous.ignored,sourceCheckedAt:new Date().toISOString()},device);
        result=mutateTask(result,{id:previous.id,deleted:true},device);
        old=result.find(t=>t.id===patch.id);
      }
    }
    // Migrate only a unique old Yanhe record whose source identifies this exact course.
    if (!old && patch.platform === 'yanhe' && patchSource.startsWith('eclass:')) {
      const coursePath = new URL(patch.sourceUrl).pathname.match(/^\/course\/(\d+)\//)?.[1];
      const matches = result.filter(t => t.platform === 'yanhe' && !importSource(t).startsWith('eclass:') && t.title === patch.title && t.dueAt === patch.dueAt && (() => {
        try {const u = new URL(t.sourceUrl);return u.hostname === 'zy-eclass.bit.edu.cn' && new RegExp(`/(?:course|courses)/${coursePath}/`).test(u.pathname);} catch {return false;}
      })());
      if (matches.length === 1) {
        const previous = matches[0];
        const seed = {...previous, ...patch, completed: previous.completed, deleted: previous.deleted, notes: previous.notes, sourceCheckedAt: new Date().toISOString()};
        result = mutateTask(result, seed, device);
        result = mutateTask(result, {id: previous.id, deleted: true}, device);
        old = result.find(t => t.id === patch.id);
      }
    }
    // A platform item archived by the report rule can return when the report lists it
    // again; a user's own deletion stays deleted.
    if (old?.deleted) {
      if (!old.autoArchived) continue;
      patch.deleted = false;patch.autoArchived = false;
    }
    // An ignored platform item is only seeded on first import; a later refresh must not
    // override the user's own ignore choice.
    if (old && patch.ignored !== undefined) delete patch.ignored;
    if (old && patch.sourceKind) patch.notes = old.notes;
    if (old && !patch.homeworkProgress && patch.sourceState === 'unknown' && old.sourceState !== 'unknown') delete patch.sourceState;
    if (old && Object.entries(patch).every(([k, v]) => ['homeworkProgress','programmingInfo','score'].includes(k)?JSON.stringify(old[k])===JSON.stringify(v):old[k] === v)) continue;
    if (patch.sourceKind) patch.sourceCheckedAt = new Date().toISOString();
    result = mutateTask(result, patch, device);
  }
  return result;
}
export function importJSON(text) {
  const value = JSON.parse(text);
  if (value?.schema === 1 && Array.isArray(value.tasks)) return { backup: validateTasks(value.tasks) };
  const assignments = Array.isArray(value) ? value : value.assignments;
  if (!Array.isArray(assignments)) throw new Error('JSON 应为任务数组、assignments 数组或归序备份');
  return { assignments };
}
export function parseICS(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  if (!lines.includes('BEGIN:VCALENDAR')) throw new Error('不是有效的 ICS 日历');
  const events = []; let current = null;
  const unescape = s => s.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
  function date(value, key) {
    if (key.includes('TZID=') && !/TZID="?(Asia\/Shanghai|Asia\/Chongqing|Asia\/Hong_Kong|UTC)"?(;|$)/.test(key)) throw new Error('ICS 时区暂只支持北京时间和 UTC，请先导出为 UTC');
    if (/^\d{8}$/.test(value)) return parseDeadline(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
    const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
    if (!m) throw new Error(`ICS 日期格式不正确：${value}`);
    const [, y, mo, d, h, mi, s, z] = m;
    return parseDeadline(`${y}-${mo}-${d}T${h}:${mi}:${s}${z || (key.includes('TZID=UTC') ? 'Z' : '+08:00')}`);
  }
  for (const line of lines) {
    if (/^BEGIN:(VEVENT|VTODO)$/.test(line)) current = {};
    else if (/^END:(VEVENT|VTODO)$/.test(line) && current) {
      if (!current.title || !current.dueAt) throw new Error('ICS 中有事项缺少标题或日期');
      events.push(current); current = null;
    } else if (current) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const key = line.slice(0, i), value = line.slice(i + 1), field = key.split(';')[0];
      if (field === 'SUMMARY') current.title = unescape(value);
      if (field === 'UID') current.sourceId = value;
      if (field === 'DESCRIPTION') current.notes = unescape(value);
      if (field === 'URL' && /^https:\/\//.test(value)) current.sourceUrl = value;
      if (field === 'DUE' || field === 'DTEND' || (field === 'DTSTART' && !current.dueAt)) {
        current.dueAt = date(value, key);
        // An all-day VEVENT's DTEND is exclusive; VTODO DUE is not.
        if (field === 'DTEND' && /^\d{8}$/.test(value)) current.dueAt = new Date(Date.parse(current.dueAt) - 86400000).toISOString();
      }
    }
  }
  if (!events.length) throw new Error('ICS 中没有可导入的日程');
  return events;
}
