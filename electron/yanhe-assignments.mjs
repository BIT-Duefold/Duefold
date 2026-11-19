import {parseDeadline, MAX_TASKS} from '../shared/model.mjs';
export const ECLASS_ORIGIN = 'https://zy-eclass.bit.edu.cn';
const idText = value => {const s = String(value);if (!/^\d{1,15}$/.test(s)) throw new Error('课程或任务标识格式变化');return s;};
export function sourceState(row, kind) {
  if (row.resubmit_record?.submitted === false && row.resubmit_record?.is_closed === false) return 'returned';
  if (typeof row.submitted === 'boolean') return row.submitted ? 'submitted' : row.has_temporary_submission === true ? 'draft' : 'unsubmitted';
  if (kind === 'exam' && Number.isInteger(row.submission_count) && row.submission_count >= 0) {
    return row.submission_count > 0 || row.makeup_exam_submission_count > 0 ? 'submitted' : row.has_temporary_submission === true ? 'draft' : 'unsubmitted';
  }
  return 'unknown';
}
export function normalizeActivity(row, course, kind) {
  if (row.published === false) return null;
  const courseId = idText(course.id), id = idText(row.id);
  if (typeof row.title !== 'string' || !row.title.trim()) throw new Error('平台任务缺少标题');
  let due = row.deadline ?? row.end_time ?? null;
  if (row.can_make_up_homework === true && row.make_up_closed_time) due = row.make_up_closed_time;
  return {sourceId: `eclass:${courseId}:${kind}:${id}`, platform: 'yanhe', sourceKind: kind, sourceState: sourceState(row, kind),
    title: row.title.trim(), course: course.display_name || course.name || '', dueAt: parseDeadline(due),
    sourceUrl: `${ECLASS_ORIGIN}/course/${courseId}/${kind === 'homework' ? 'homework' : 'exam'}`,
    notes: kind === 'exam' && Number.isFinite(row.limit_time) && row.limit_time > 0 ? `测试限时：${row.limit_time} 分钟。请在原平台确认具体规则。` : ''};
}
const aborted = signal => {if (signal?.aborted) throw new Error('采集已取消');};
export async function collectYanheAssignments({request, signal, onProgress = () => {}, onCourses = () => {}, isCourseEnabled = () => true, maxPages = 100, pageSize = 50}) {
  const courses = [], assignments = [], errors = [];let seenCourses = new Set();
  async function pages(path, key, method = 'GET', extra = {}) {
    const rows = [], seen = new Set();let expected;
    for (let page = 1; page <= maxPages; page++) {
      aborted(signal);
      const params = {page, page_size: pageSize, ...extra};
      const body = await request(path, {method, params, signal});aborted(signal);
      if (!Array.isArray(body?.[key]) || !Number.isSafeInteger(body.total) || body.total < 0) throw new Error('平台列表格式变化，未能确认完整覆盖');
      if (body.total > MAX_TASKS) throw new Error('平台列表超过容量上限');
      if (expected !== undefined && expected !== body.total) throw new Error('平台列表在分页期间发生变化，请稍后重试');
      expected = body.total;
      const batch = body[key];
      for (const row of batch) {const id = idText(row.id);if (seen.has(id)) throw new Error('平台返回重复分页，未能确认完整覆盖');seen.add(id);rows.push(row);}
      if (rows.length >= expected) {if (rows.length !== expected) throw new Error('平台分页数量不一致');return rows;}
      if (!batch.length) throw new Error('平台分页提前结束');
    }
    throw new Error('平台分页达到上限，采集未完成');
  }
  onProgress({phase: 'courses', total: 0, completed: 0});
  for (const row of await pages('/api/my-courses', 'courses', 'POST', {fields: 'id,name,display_name,is_instructor', conditions: {keyword: '', display_studio_list: false}})) {
    const id = idText(row.id);if (seenCourses.has(id)) continue;seenCourses.add(id);courses.push(row);
  }
  await onCourses(courses.map(row => ({id: String(row.id), title: row.display_name || row.name || `课程 ${row.id}`})));aborted(signal);
  const selected = courses.filter(row => isCourseEnabled(String(row.id)));
  let cursor = 0, completed = 0;
  onProgress({phase: 'activities', total: selected.length, discovered: courses.length, completed});
  async function worker() {
    while (cursor < selected.length) {
      aborted(signal);const course = selected[cursor++];
      for (const [kind, suffix, key] of [['homework','homework-activities','homework_activities'],['exam','exam-list','exams']]) {
        try {
          const rows = await pages(`/api/courses/${idText(course.id)}/${suffix}`, key, 'GET', {conditions: JSON.stringify({itemsSortBy: {predicate: 'module', reverse: false}})});
          const batch = rows.map(row => normalizeActivity(row, course, kind)).filter(Boolean);
          if (assignments.length + batch.length > MAX_TASKS) throw new Error('任务数量超过容量上限');
          assignments.push(...batch);
        } catch (error) {
          aborted(signal);
          if (error.code === 'login_required') throw error;
          errors.push({courseId: String(course.id), kind, message: '该课程部分条目未能读取'});
        }
      }
      completed++;onProgress({phase: 'activities', total: selected.length, discovered: courses.length, completed});
    }
  }
  const results = await Promise.allSettled([worker(),worker()]);
  const failed = results.find(r => r.status === 'rejected');if (failed) throw failed.reason;
  aborted(signal);
  return {assignments, courses: selected.length, discovered: courses.length, skipped: courses.length - selected.length, completed, errors, complete: !errors.length};
}

// Runs in an isolated official eclass document. Only known read-only listing endpoints are accepted.
export async function readEclassList(path, options) {
  if (location.origin !== 'https://zy-eclass.bit.edu.cn' || !/^\/api\/(my-courses|courses\/\d+\/(homework-activities|exam-list))$/.test(path)) throw new Error('读取地址不受信任');
  const method = path === '/api/my-courses' ? 'POST' : 'GET';
  if (options.method !== method) throw new Error('读取方式不受信任');
  const headers = {Accept: 'application/json'};
  const xsrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('XSRF-TOKEN='));
  if (xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf.slice(11));
  const input = {method, credentials: 'include', redirect: 'error', headers, signal: AbortSignal.timeout(15000)};
  let url = path;
  if (method === 'POST') {headers['Content-Type'] = 'application/json';input.body = JSON.stringify(options.params);}
  else url += '?' + new URLSearchParams(options.params);
  let response;try {response = await fetch(url, input);} catch {return {failure: 'network'};}
  if ([401,403].includes(response.status)) return {failure: 'login_required'};
  if (!response.ok || !/json/i.test(response.headers.get('content-type') || '')) return {failure: 'service'};
  const reader = response.body.getReader();let size = 0;const chunks = [];
  try {
    while (true) {const {done,value} = await reader.read();if (done) break;size += value.length;if (size > 4 * 1024 * 1024) return {failure: 'too_large'};chunks.push(value);}
    const bytes = new Uint8Array(size);let offset = 0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    // Do not pass answers, attachments, grades or identities back to the main process.
    const key = path === '/api/my-courses' ? 'courses' : path.endsWith('exam-list') ? 'exams' : 'homework_activities';
    if (!Array.isArray(raw[key])) return {failure: 'shape'};
    const fields = key === 'courses' ? ['id','name','display_name','is_instructor'] : ['id','title','published','submitted','has_temporary_submission','submission_count','makeup_exam_submission_count','deadline','end_time','can_make_up_homework','make_up_closed_time','limit_time'];
    return {total: raw.total, [key]: raw[key].map(row => {
      const result = Object.fromEntries(fields.filter(k => Object.hasOwn(row,k)).map(k => [k,row[k]]));
      if (row.resubmit_record) result.resubmit_record = {submitted: row.resubmit_record.submitted, is_closed: row.resubmit_record.is_closed};
      return result;
    })};
  } catch {return {failure: 'shape'};} finally {await reader.cancel().catch(() => {});}
}
