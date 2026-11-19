import {parseDeadline,MAX_TASKS} from '../shared/model.mjs';
import {validateProgrammingInfo} from '../shared/programming-info.mjs';

export const LEXUE_ORIGIN='https://lexue.bit.edu.cn';
const failure=(code,message)=>Object.assign(new Error(message),{code});
const numberId=value=>{const id=String(value);if(!/^\d{1,16}$/.test(id))throw failure('shape','乐学标识结构变化');return id;};
export function lexueDate(value) {
  if(value==null||value===''||/^[-—]$|未设置|无限制/.test(value))return null;
  const match=String(value).match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(?:星期[一二三四五六日天]\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(!match)throw failure('date','乐学日期结构变化');
  const [,y,m,d,h,min,sec='00']=match;
  return parseDeadline(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:${sec}+08:00`);
}
// Moodle renders activities the account cannot open without a module link, so the
// availability notice is the only evidence: an end date is a real deadline, while
// "不能使用" means the activity is simply unavailable to this account.
export function lexueRestriction(value) {
  const note=String(value||'').replace(/\s+/g,' ').trim();
  if(!note||!/受限|Restricted/i.test(note))return null;
  if(/不能使用/.test(note))return {kind:'blocked'};
  const until=note.match(/直到\s*(\d{4}年\s*\d{1,2}月\s*\d{1,2}日(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?)\s*(?:前)?\s*可访问/);
  if(until)return {kind:'until',text:until[1]};
  return {kind:'blocked'};
}
export function lexueUntilDate(value) {
  const match=String(value).match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(!match)throw failure('date','乐学日期结构变化');
  const [,y,m,d,h,min,sec]=match;
  return h===undefined?parseDeadline(`${y}-${m}-${d}`):lexueDate(`${y}年${m}月${d}日 ${h}:${min}${sec?':'+sec:''}`);
}
// The grade report drives the new todo set: range max > 0 and a module link make an
// item countable and the grade cell supplies the score tag.
export function lexueRange(value) {
  const text=String(value==null?'':value).replace(/\s+/g,' ').trim();
  const match=text.match(/^(-?\d+(?:\.\d+)?)\s*[-–—~]\s*(-?\d+(?:\.\d+)?)$/);
  if(!match)return null;
  const min=Number(match[1]),max=Number(match[2]);
  if(!Number.isFinite(min)||!Number.isFinite(max)||max<=0)return null;
  return {min,max};
}
export function lexueGrade(value) {
  const text=String(value==null?'':value).replace(/\s+/g,' ').trim();
  if(text===''||/^[-–—]$/.test(text))return {state:'unsubmitted',score:null};
  const score=Number(text.replace(/,/g,''));
  if(Number.isFinite(score))return {state:'submitted',score};
  return {state:'unknown',score:null};
}
export function lexueSubmissionState(value) {
  const status=String(value||'').replace(/\s+/g,' ').trim();
  if(/草稿|Draft/i.test(status))return 'draft';
  if(/^(已提交|已提交[，, ]*(请评分|以?供评分|待评分|等待评分)|提交以供评分|Submitted for grading)$/i.test(status))return 'submitted';
  if(/^(没有作业|没有尝试|尚未提交(?:作业)?|未提交(?:作业)?|No submission|No attempt)$/i.test(status))return 'unsubmitted';
  return 'unknown';
}
export function lexueQuizState({attempts=[],buttons=[]}) {
  // The last attempt matters: a newer ongoing attempt must not inherit an old submission.
  const last=attempts.at(-1)||'';
  if(/进行中|正在进行|In progress/i.test(last))return 'draft';
  if(/已结束.*已提交|Finished.*Submitted/i.test(last))return 'submitted';
  if(!attempts.length&&buttons.some(s=>/^(现在试答|开始试答|Attempt quiz now)$/.test(s)))return 'unsubmitted';
  return 'unknown';
}
export function lexueProgrammingState(result) {
  if(Number.isInteger(result.total)&&result.total>0&&result.total<=100000&&Number.isInteger(result.passed)&&result.passed>=0&&result.passed<=result.total)return result.passed===result.total?'submitted':'returned';
  if(result.noSubmission===true)return 'unsubmitted';
  return 'unknown';
}

export async function collectLexueAssignments({request,signal,onCourses=()=>{},isCourseEnabled=()=>true,onProgress=()=>{},onCourse=()=>{}}) {
  const check=()=>{if(signal?.aborted)throw failure('cancelled','乐学采集已取消');};
  const call=async(op,args)=>{check();const result=await request(op,args);check();if(result?.failure)throw failure(result.failure,'乐学查询未能完成');return result;};
  const courses=new Map();onProgress({phase:'courses',total:0,completed:0});
  const hiddenIds=new Set();
  for(const classification of ['all','hidden']) {
    let offset=0,ended=false;
    for(let page=0;page<125;page++) {
      const data=await call('courses',{classification,offset,limit:100});
      if(!Array.isArray(data?.courses)||!Number.isInteger(data.nextoffset))throw failure('shape','乐学课程目录结构变化');
      if(!data.courses.length){ended=true;break;}
      for(const row of data.courses){const id=numberId(row.id);if(typeof row.title!=='string'||!row.title.trim()||row.title.length>200)throw failure('shape','乐学课程缺少标题');courses.set(id,{id,title:row.title.trim()});if(classification==='hidden')hiddenIds.add(id);}
      if(courses.size>1000)throw failure('limit','乐学课程超过读取上限');
      if(data.nextoffset<=offset)throw failure('pagination','乐学课程分页未向后推进');
      offset=data.nextoffset;
    }
    if(!ended)throw failure('limit','乐学课程分页超过读取上限');
  }
  check();onCourses([...courses.values()],[...hiddenIds]);check();
  const selected=[...courses.values()].filter(c=>isCourseEnabled(c.id,c.title)),assignments=[],errors=[];
  let completed=0,unknown=0;
  const report=(course,area,error)=>{check();if(error.code==='login_required'||error.code==='cancelled'||error.code==='limit')throw error;errors.push({course:course.id,area,code:error.code||'network'});};
  // Fallback for a course without a usable grade report: the original index/section scan.
  const collectLegacy=async course=>{
    const activities=new Map(),items=[];
    const remember=rows=>{if(!Array.isArray(rows))throw failure('shape','乐学活动目录结构变化');for(const row of rows){const id=numberId(row.id);if(!['assign','quiz','programming'].includes(row.kind)||typeof row.title!=='string'||!row.title.trim()||row.title.length>500)throw failure('shape','乐学活动结构变化');const key=row.kind+':'+id;activities.set(key,{...activities.get(key),...row,id});}if(activities.size>MAX_TASKS)throw failure('limit','乐学活动超过读取上限');};
    for(const kind of ['assign','quiz']) {
      try{const index=await call('index',{courseid:course.id,kind});remember(index.activities);}catch(error){report(course,kind+'_index',error);}
    }
    try {
      const overview=await call('course',{courseid:course.id});remember(overview.activities);
      const sections=new Set(overview.sections);
      if(sections.size>500)throw failure('limit','乐学章节超过读取上限');
      for(const section of sections){check();try{const page=await call('course',{courseid:course.id,section:numberId(section)});remember(page.activities);}catch(error){report(course,'section',error);}}
    }catch(error){report(course,'course',error);}
    for(const row of activities.values()) {
      check();
      const restriction=lexueRestriction(row.availability);
      const item={platform:'lexue',sourceId:`moodle:${course.id}:${row.kind}:${row.id}`,title:row.title.trim(),course:course.title,sourceKind:row.kind==='quiz'?'exam':'homework',sourceState:row.kind==='assign'?lexueSubmissionState(row.status):'unknown',dueAt:null,sourceUrl:`${LEXUE_ORIGIN}/mod/${row.kind}/view.php?id=${row.id}`};
      if(restriction?.kind==='until') {
        try{item.dueAt=lexueUntilDate(restriction.text);}catch(error){report(course,'date',error,row.title);}
        item.sourceState=item.dueAt&&Date.parse(item.dueAt)<Date.now()?'expired':'unknown';
      } else if(restriction?.kind==='blocked') {
        item.ignored=true;
      } else {
        try{item.dueAt=lexueDate(row.dueText);}catch(error){report(course,'date',error,row.title);}
        try {
          const detail=await call('detail',{kind:row.kind,id:row.id});
          if(row.kind==='quiz'){item.sourceState=lexueQuizState(detail);if(detail.dueText)item.dueAt=lexueDate(detail.dueText);}
          if(row.kind==='assign'){item.sourceState=lexueSubmissionState(detail.status);if(detail.dueText)item.dueAt=lexueDate(detail.dueText);}
          if(row.kind==='programming') {
            const fields=detail.fields||{};
            const info=validateProgrammingInfo({openAt:lexueDate(fields['开启时间']),discountAt:lexueDate(fields['折扣时间']),closeAt:lexueDate(fields['关闭时间']),discountFactor:fields['折扣']!=null&&fields['折扣']!==''?Number(fields['折扣']):null,allowLate:fields['允许迟交']==='是'?true:fields['允许迟交']==='否'?false:null,total:null,passed:null});
            item.programmingInfo=info;item.dueAt=info.discountAt||info.closeAt;
            try{const result=await call('programmingResult',{id:row.id});item.sourceState=lexueProgrammingState(result);if(['submitted','returned'].includes(item.sourceState)){info.total=result.total;info.passed=result.passed;}}catch(error){report(course,'programming_result',error,row.title);}
          }
        }catch(error){report(course,row.kind+'_detail',error,row.title);}
      }
      if(item.sourceState==='unknown'&&!item.ignored)unknown++;
      assignments.push(item);items.push(item);if(assignments.length>MAX_TASKS)throw failure('limit','乐学事项超过读取上限');
    }
    return items;
  };
  const readCourses=[];
  for(const course of selected) {
    check();onProgress({phase:'activities',total:selected.length,completed});
    let grades=null,gradeError=null;
    try{grades=await call('grades',{courseid:course.id});}catch(error){gradeError=error;}
    const courseItems=[];let readable=true;
    if(grades&&Array.isArray(grades.rows)&&grades.rows.length>0) {
      const known=new Set();
      for(const row of grades.rows) {
        check();
        if(typeof row?.title!=='string'||!row.title.trim()||row.title.length>500)continue;
        const range=lexueRange(row.range);if(!range)continue;
        if(!['assign','quiz','programming'].includes(row.kind))continue;
        const activityId=numberId(row.id),key=row.kind+':'+activityId;
        if(known.has(key))continue;known.add(key);
        const grade=lexueGrade(row.grade);
        const item={platform:'lexue',sourceId:`moodle:${course.id}:${row.kind}:${activityId}`,title:row.title.trim(),course:course.title,sourceKind:row.kind==='quiz'?'exam':'homework',sourceState:row.kind==='assign'?'unknown':grade.state,dueAt:null,sourceUrl:`${LEXUE_ORIGIN}/mod/${row.kind}/view.php?id=${activityId}`};
        if(grade.score!=null)item.score={earned:grade.score,total:range.max};
        try {
          const detail=await call('detail',{kind:row.kind,id:activityId});
          if(row.kind==='assign')item.sourceState=lexueSubmissionState(detail.status);
          if((row.kind==='quiz'||row.kind==='assign')&&detail.dueText)item.dueAt=lexueDate(detail.dueText);
          if(row.kind==='programming') {
            const fields=detail.fields||{};
            const info=validateProgrammingInfo({openAt:lexueDate(fields['开启时间']),discountAt:lexueDate(fields['折扣时间']),closeAt:lexueDate(fields['关闭时间']),discountFactor:fields['折扣']!=null&&fields['折扣']!==''?Number(fields['折扣']):null,allowLate:fields['允许迟交']==='是'?true:fields['允许迟交']==='否'?false:null,total:null,passed:null});
            item.programmingInfo=info;item.dueAt=info.discountAt||info.closeAt;
          }
        }catch(error){report(course,row.kind+'_detail',error,row.title);}
        if(item.sourceState==='unknown')unknown++;
        assignments.push(item);courseItems.push(item);
        if(assignments.length>MAX_TASKS)throw failure('limit','乐学事项超过读取上限');
      }
    } else if(gradeError&&gradeError.code!=='unavailable') {
      report(course,'grades',gradeError);
    } else {
      const before=errors.length;
      courseItems.push(...await collectLegacy(course));
      if(!courseItems.length&&errors.length>before)readable=false;
    }
    check();onCourse(courseItems,course.id);
    if(readable)readCourses.push({id:course.id,sourceIds:[...new Set(courseItems.map(item=>item.sourceId))]});
    completed++;onProgress({phase:'activities',total:selected.length,completed});
  }
  check();return{assignments,read:readCourses,discovered:courses.size,courses:selected.length,skipped:courses.size-selected.length,completed,errors,unknown,complete:errors.length===0};
}

// Runs in the teaching-site renderer. Only metadata is returned; never execute HTML scripts,
// follow action links, fetch attempts/reviews, or submit a form.
export async function readLexueMetadata(operation,args={}) {
  const origin='https://lexue.bit.edu.cn',id=value=>/^\d{1,16}$/.test(String(value))?String(value):null;
  if(location.origin!==origin||!window.M?.cfg?.sesskey||document.body.classList.contains('notloggedin')||!document.querySelector('a[href*="/login/logout.php"]'))return{failure:'login_required'};
  const text=element=>(element?.textContent||'').trim().replace(/\s+/g,' ');
  const link=(element,base)=>{try{const url=new URL(element.getAttribute('href'),base);return url.origin===origin?url:null;}catch{return null;}};
  let path,options={method:'GET',credentials:'same-origin',redirect:'manual'};
  if(operation==='courses') {
    if(!['all','hidden'].includes(args.classification)||!Number.isInteger(args.offset)||args.offset<0||args.limit!==100)return{failure:'unsafe_request'};
    const method='core_course_get_enrolled_courses_by_timeline_classification';
    path='/lib/ajax/service.php?sesskey='+encodeURIComponent(M.cfg.sesskey)+'&info='+method;
    options={...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{index:0,methodname:method,args:{classification:args.classification,offset:args.offset,limit:100,sort:'fullname'}}])};
  }else if(operation==='grades'&&id(args.courseid))path='/grade/report/user/index.php?id='+id(args.courseid);
  else if(operation==='course'&&id(args.courseid)&&(args.section===undefined||id(args.section)))path='/course/view.php?id='+id(args.courseid)+(args.section!==undefined?'&section='+id(args.section):'');
  else if(operation==='index'&&id(args.courseid)&&['assign','quiz'].includes(args.kind))path='/mod/'+args.kind+'/index.php?id='+id(args.courseid);
  else if(operation==='detail'&&id(args.id)&&['assign','quiz','programming'].includes(args.kind))path='/mod/'+args.kind+'/view.php?id='+id(args.id);
  else if(operation==='programmingResult'&&id(args.id))path='/mod/programming/result.php?id='+id(args.id);
  else return{failure:'unsafe_request'};
  // The largest grade report can take ~20s to build; following same-origin redirects
  // also avoids mistaking a transient redirect for an unavailable report.
  if(operation==='grades')options={...options,redirect:'follow'};
  const timeoutMs=operation==='grades'?45000:18000;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(path,{...options,signal:controller.signal});
    if(response.type==='opaqueredirect')return{failure:operation==='grades'?'unavailable':'login_required'};
    if(!response.ok)return{failure:[401,403].includes(response.status)?'login_required':'network'};
    const responseURL=new URL(response.url);
    if(responseURL.origin!==origin)return{failure:'login_required'};
    if(operation==='grades'&&responseURL.pathname!=='/grade/report/user/index.php')return{failure:'unavailable'};
    const raw=await response.text();if(raw.length>6*1024*1024)return{failure:'limit'};
    if(operation==='courses') {
      let value;try{value=JSON.parse(raw)?.[0];}catch{return{failure:'login_required'};}
      if(value?.error)return{failure:/requirelogin|invalidsesskey|notloggedin/.test(value.exception?.errorcode||'')?'login_required':'service'};
      const data=value?.data;if(!Array.isArray(data?.courses))return{failure:'shape'};
      return{courses:data.courses.map(c=>({id:c.id,title:c.fullname})),nextoffset:data.nextoffset};
    }
    const doc=new DOMParser().parseFromString(raw,'text/html');
    if(doc.body.classList.contains('notloggedin')||doc.querySelector('input[type="password"]')||!doc.querySelector('a[href*="/login/logout.php"]'))return{failure:'login_required'};
    if(operation==='grades') {
      // The user report is the authoritative todo list: only graded items with a
      // positive range and a module link count.
      const table=[...doc.querySelectorAll('table')].find(t=>/范围|Range/i.test(text(t))&&/成绩|Grade/i.test(text(t)));
      if(!table)return{failure:'unavailable'};
      const heads=[...table.querySelectorAll('thead th')].map(text);
      if(!heads.length)return{failure:'shape'};
      // Header cells and data cells share the same physical order even though the
      // 成绩项 header spans two visual columns, so use the header ordinal directly.
      const gradeCol=heads.findIndex(h=>/^成绩$|^Grade$/i.test(h)),rangeCol=heads.findIndex(h=>/^范围$|^Range$/i.test(h));
      if(gradeCol<0||rangeCol<0)return{failure:'shape'};
      const rows=[];
      for(const tr of table.querySelectorAll('tbody tr')) {
        const cells=[...tr.children].map(text);
        if(cells.length<=Math.max(gradeCol,rangeCol))continue;
        const anchor=tr.querySelector('a[href*="/mod/"]'),u=anchor&&link(anchor,response.url);
        const kind=u&&/^\/mod\/([a-z]+)\/view\.php$/.exec(u.pathname)?.[1],activityId=u&&id(u.searchParams.get('id'));
        if(!anchor||!kind||!activityId)continue;
        rows.push({title:text(anchor),kind,id:activityId,grade:cells[gradeCol],range:cells[rangeCol]});
      }
      return{rows};
    }
    // Moodle renders its explicit empty-module message inside an alert-danger too.
    // Do not confuse a confirmed empty list with a server failure.
    if(operation==='index'&&[...doc.querySelectorAll('.errorbox,.alert-danger')].some(e=>new RegExp(args.kind==='assign'?'该课程中没有作业|There are no assignments':'该课程中没有测验|There are no quizzes','i').test(text(e))))return{activities:[]};
    if(doc.querySelector('.errorbox,.alert-danger')||/coding_exception|PHP catchable fatal error/.test(doc.body.textContent))return{failure:'service'};
    const main=doc.querySelector('#region-main');if(!main)return{failure:'shape'};
    if(operation==='course') {
      const sections=new Set(),activities=[],unsupported=[];
      for(const anchor of main.querySelectorAll('a[href]')){const u=link(anchor,response.url);if(u?.pathname==='/course/view.php'&&u.searchParams.get('id')===String(args.courseid)&&id(u.searchParams.get('section')))sections.add(u.searchParams.get('section'));}
      for(const activity of main.querySelectorAll('li.activity')) {
        const kind=/modtype_(\w+)/.exec(activity.className)?.[1];
        if(['workshop','vpl','assignfeedback'].includes(kind))unsupported.push(kind);
        if(!['assign','quiz','programming'].includes(kind))continue;
        const title=activity.querySelector('.instancename')?.cloneNode(true);title?.querySelectorAll('.accesshide').forEach(e=>e.remove());
        const anchor=activity.querySelector('a[href*="/mod/'+kind+'/view.php"]'),u=anchor&&link(anchor,response.url);
        if(u&&id(u.searchParams.get('id'))){activities.push({id:u.searchParams.get('id'),kind,title:text(title||anchor)});continue;}
        // Moodle drops the module link when this account is restricted, so fall back to
        // the li id and keep the availability notice for the collector to interpret.
        const moduleId=/^module-(\d{1,16})$/.exec(activity.id)?.[1];
        if(!moduleId)return{failure:'shape'};
        activities.push({id:moduleId,kind,title:text(title),availability:text(activity.querySelector('.availabilityinfo'))});
      }
      if(!main.querySelector('.course-content'))return{failure:'shape'};
      return{sections:[...sections],activities,unsupported};
    }
    if(operation==='index') {
      const table=main.querySelector('table.generaltable');
      if(!table)return /该课程中没有作业|该课程中没有测验|There are no (assignments|quizzes)/i.test(text(main))?{activities:[]}:{failure:'shape'};
      const headers=[...table.querySelectorAll('tr th')].map(text),dueIndex=headers.findIndex(h=>/到期日期|测验关闭|Due date|Quiz closes/i.test(h));
      if(dueIndex<0)return{failure:'shape'};
      const activities=[];
      for(const row of table.querySelectorAll('tr')) {
        const cells=[...row.children].filter(e=>e.tagName==='TD');if(cells.length<=1)continue;
        const anchor=row.querySelector('a[href]');if(!anchor)return{failure:'shape'};
        const u=link(anchor,response.url);if(!u||u.pathname!=='/mod/'+args.kind+'/view.php'||!id(u.searchParams.get('id')))return{failure:'shape'};
        activities.push({id:u.searchParams.get('id'),kind:args.kind,title:text(anchor),dueText:text(cells[dueIndex]),status:args.kind==='assign'?text(cells[dueIndex+1]):''});
      }
      return{activities};
    }
    if(operation==='programmingResult') {
      // Match just the scalar summary. Test inputs, outputs and source code never cross back.
      const summary=text(main).match(/测试结果[：:]\s*共\s*(\d+)\s*个测试用例[，,]\s*您的程序通过了其中的\s*(\d+)\s*个/);
      return summary?{total:Number(summary[1]),passed:Number(summary[2])}:{noSubmission:/尚未提交(?:程序|作业)|没有提交(?:程序|记录)|You have not submitted/i.test(text(main))};
    }
    if(args.kind==='programming') {
      const table=[...main.querySelectorAll('table.generaltable')].find(t=>/开启时间/.test(text(t))&&/关闭时间/.test(text(t)));
      if(!table)return{failure:'shape'};const fields={};
      for(const row of table.querySelectorAll('tr')){const cells=[...row.querySelectorAll('th,td')];for(let n=0;n+1<cells.length;n+=2){const label=text(cells[n]);if(['开启时间','折扣时间','关闭时间','折扣','允许迟交'].includes(label))fields[label]=text(cells[n+1]);}}
      return{fields};
    }
    const dates=text(main.querySelector('[data-region="activity-dates"]'));
    if(args.kind==='assign') {
      let status='';for(const row of main.querySelectorAll('table.generaltable tr')){const cells=[...row.querySelectorAll('th,td')];if(/^(作业状态|提交状态|Submission status)$/i.test(text(cells[0])))status=text(cells[1]);}
      return{status,dueText:dates.match(/(?:到期日|到期日期|Due)[：:]?\s*(\d{4}年[^]*?\d{1,2}:\d{2}(?::\d{2})?)/i)?.[1]||''};
    }
    const attempts=[];for(const row of main.querySelectorAll('table.quizattemptsummary tbody tr')){const cells=[...row.querySelectorAll('td')];if(cells.length>1)attempts.push(text(cells[1]));}
    const buttons=[...main.querySelectorAll('form')].filter(f=>{try{return new URL(f.getAttribute('action'),response.url).pathname==='/mod/quiz/startattempt.php';}catch{return false;}}).flatMap(f=>[...f.querySelectorAll('button,input[type="submit"]')].map(e=>e.tagName==='BUTTON'?text(e):e.value));
    return{attempts,buttons,dueText:dates.match(/(?:已关闭|关闭|Closes)[：:]?\s*(\d{4}年[^]*?\d{1,2}:\d{2}(?::\d{2})?)/i)?.[1]||''};
  }catch{return{failure:'network'};}finally{clearTimeout(timer);}
}
