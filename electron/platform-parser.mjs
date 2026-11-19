import { parseDeadline } from '../shared/model.mjs';
const dueFields = ['deadline', 'dueAt', 'dueDate', 'due_time', 'dueTime', 'endTime', 'end_time', 'endDate', 'timeclose', 'timedue', 'submitEndTime', 'submitDeadline', 'homeworkEndTime', 'expireTime'];
export function extractCourseNames(payload, sourceURL) {
  const names = new Set();let visited = 0;
  const courseEndpoint = /course|clazz/i.test(new URL(sourceURL).pathname);
  function visit(node, key = '', depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12 || visited++ > 20000) return;
    if (Array.isArray(node)) {for (const item of node) visit(item,key,depth+1);return;}
    const name = node.courseName || node.coursename || node.course?.fullname || ((courseEndpoint && /course|clazz/i.test(key)) ? node.fullname || node.name || node.title : '');
    if (typeof name === 'string' && name.trim() && name.length <= 200) names.add(name.trim());
    for (const [k,v] of Object.entries(node)) if (v && typeof v === 'object') visit(v,k,depth+1);
  }
  visit(payload);return [...names];
}
export function extractAssignments(payload, platform, sourceURL) {
  const result = new Map(); let visited = 0;
  const url = new URL(sourceURL);
  const assignmentEndpoint = /assign|homework|exam|quiz/i.test(url.pathname + (url.searchParams.get('r') || ''));
  function visit(node, course = '', depth = 0) {
    if (!node || typeof node !== 'object' || depth > 16 || visited++ > 50000) return;
    if (Array.isArray(node)) {for (const child of node) visit(child, course, depth + 1);return;}
    course = typeof node.courseName === 'string' ? node.courseName : typeof node.coursename === 'string' ? node.coursename : node.course?.fullname || course;
    const title = node.homeworkName || node.assignmentName || node.examName || node.quizName || node.title || node.name;
    const due = dueFields.map(k => node[k]).find(v => v != null && v !== '' && v !== 0 && v !== '0');
    const explicitAssignment = node.homeworkName || node.assignmentName || node.examName || node.quizName || node.deadline || node.timedue || node.submitDeadline || node.homeworkEndTime;
    if ((assignmentEndpoint || explicitAssignment) && typeof title === 'string' && title.trim() && due !== undefined) {
      try {
        const dueAt = parseDeadline(due);
        const sourceId = node.homeworkId || node.assignmentId || node.examId || node.id || `${course}|${title}|${dueAt}`;
        const suppliedURL = node.url || node.viewurl || node.sourceUrl;
        const url = typeof suppliedURL === 'string' && /^https:\/\//.test(suppliedURL) ? suppliedURL : sourceURL;
        result.set(String(sourceId), {sourceId: String(sourceId), platform, title: title.trim(), dueAt, course, sourceUrl: url, notes: '来自平台接口，课程覆盖范围需结合读取状态核验。'});
      } catch { /* Never guess an unrecognizable deadline. */ }
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value, course, depth + 1);
  }
  visit(payload); return [...result.values()];
}
// Runs inside an isolated, unprivileged platform page. No Node, preload, or application credentials.
export function scanPage() {
  const rows = document.querySelectorAll('.activity-item,.activityinstance,.assignment-item,.homework-item,.exam-item,.task-item,.test-item,[data-region="event-item"],[data-type="homework"],.el-table__row,tr');
  const items = [];
  for (const row of [...rows].slice(0, 2000)) {
    const text = (row.innerText || '').trim();
    const m = text.match(/(?:截止(?:日期|时间)?|提交期限|due(?:\s+date)?)[：:\s]*?(\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i);
    if (!m || text.length > 4000) continue;
    const anchor = row.querySelector('a[href]');
    const titleNode = row.querySelector('.instancename,.activityname,.homework-name,.task-name,.title,h3,h4');
    const title = (titleNode?.textContent || anchor?.textContent || '').trim();
    if (!title || title.length > 500) continue;
    const link = anchor?.href || location.href;
    items.push({sourceId: link !== location.href ? link : `${title}|${m[1]}`, title, dueAt: m[1], sourceUrl: link, course: '', notes: '从当前已加载页面读取；请核对截止日期。未覆盖其他课程、分页或未展开内容。'});
  }
  const courses = [...document.querySelectorAll('a[href*="course/view.php?id="],.coursebox .coursename,.course-card .course-name,[data-course-name]')].map(e => (e.getAttribute('data-course-name') || e.textContent || '').trim()).filter(s => s && s.length <= 200);
  return {items, courses, url: location.href, loginPage: !!document.querySelector('input[type="password"]'), title: document.title};
}
