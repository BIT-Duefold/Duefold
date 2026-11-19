const platforms = ['yanhe','lexue','mooc','zhihuishu'];
export function validateCoursePreferences(value = {}) {
  const result = {catalog: {}, excluded: {}};
  for (const id of platforms) {
    const rows = value.catalog?.[id] || [], excluded = value.excluded?.[id] || [];
    if (!Array.isArray(rows) || rows.length > 1000 || !Array.isArray(excluded) || excluded.length > 1000) throw new Error('课程选择数据超过上限');
    result.catalog[id] = [...new Map(rows.map(row => {
      if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 500 || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 200) throw new Error('课程选择数据格式不正确');
      return [row.id,{id:row.id,title:row.title.trim(),...(row.hidden===true?{hidden:true}:{})}];
    })).values()];
    if (excluded.some(key => typeof key !== 'string' || !key || key.length > 500)) throw new Error('排除课程数据格式不正确');
    result.excluded[id] = [...new Set(excluded)];
  }
  return result;
}
export function courseEnabled(preferences, platform, id) {return !preferences.excluded[platform]?.includes(String(id));}
export function taskCourseId(task) {
  let source=task.sourceId||'';
  const prefix=`import:${task.platform}:`;
  if(!source&&typeof task.id==='string'&&task.id.startsWith(prefix)) {
    try{source=decodeURIComponent(task.id.slice(prefix.length));}catch{}
  }
  source=String(source).replace(/^[^|]*\|/,'');
  let id;
  if(task.platform==='yanhe')id=/^eclass:(\d+):/.exec(source)?.[1];
  if(task.platform==='lexue')id=/^moodle:(\d+):/.exec(source)?.[1];
  if(task.platform==='mooc') {
    const match=/^spoc:(\d+):(\d+):/.exec(source);
    if(match)id=`${match[1]}:${match[2]}`;
  }
  return id || (task.course?'name:'+task.course:null);
}
export function taskCourseEnabled(preferences, task) {
  if(!preferences || task.platform==='manual')return true;
  const excluded=preferences.excluded?.[task.platform]||[];
  if(!excluded.length)return true;
  const id=taskCourseId(task);
  if(id&&!id.startsWith('name:'))return !excluded.includes(id);
  if(excluded.includes('name:'+task.course))return false;
  const matches=(preferences.catalog?.[task.platform]||[]).filter(c=>c.title===task.course);
  return matches.length!==1 || !excluded.includes(matches[0].id);
}
export function updateCourseCatalog(preferences, platform, rows, replace = false) {
  return validateCoursePreferences({...preferences,catalog:{...preferences.catalog,[platform]:[...(replace ? [] : preferences.catalog[platform] || []),...rows]}});
}
