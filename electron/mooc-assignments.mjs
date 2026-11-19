import {parseDeadline,MAX_TASKS} from '../shared/model.mjs';
import {homeworkState,validateHomeworkProgress,taskDueAt} from '../shared/homework-progress.mjs';
export const MOOC_ORIGIN = 'https://www.icourse163.org';
export const COURSE_API = '/web/j/learnerCourseRpcBean.getMyLearnedCoursePanelList.rpc';
export const TERM_API = '/web/j/courseBean.getLastLearnedMocTermDto.rpc';
export const HOMEWORK_API = '/web/j/mocQuizRpcBean.getOpenHomeworkInfo.rpc';
const numberId = value => {const s=String(value);if (!/^\d{1,16}$/.test(s)) throw new Error('MOOC 标识结构变化');return s;};
const failure = (code,message) => Object.assign(new Error(message),{code});
export function moocState(test,kind) {
  if (kind === 'exam' && Number.isInteger(test.usedTryCount) && test.usedTryCount >= 0) return test.usedTryCount > 0 ? 'submitted' : 'unsubmitted';
  if (kind === 'homework') {
    if (test.userSubmitStatus === 2) return 'submitted';
    if (test.userSubmitStatus === 1) return 'draft';
    if (test.userSubmitStatus === 0) return 'unsubmitted';
  }
  return 'unknown';
}
export function moocHomeworkState(info) {
  if(info.homeworkProgress)return homeworkState(info.homeworkProgress);
  for(const status of [info.submitStatus,info.targetAnswerform?.submitStatus]) {
    if(status===2)return 'submitted';if(status===1)return 'draft';if(status===0)return 'unsubmitted';
  }
  if(info.targetAnswerform?.submitTime>0)return 'submitted';
  return info.targetAnswerform===null?'unsubmitted':'unknown';
}
export function moocHomeworkProgress(info) {
  const status=v=>typeof v==='boolean'?(v?'done':'pending'):'unknown';
  const date=v=>typeof v==='number'&&v>0?parseDeadline(v):null;
  return validateHomeworkProgress({submission:status(info.steps?.stepSubmitted),peerReview:status(info.steps?.stepEvaluated),selfReview:status(info.steps?.stepSelfEvaluated),
    submissionDeadline:date(info.deadline)||date(info.steps?.testEnd),reviewStart:date(info.evaluateStart)||date(info.steps?.evaluateStart),reviewDeadline:date(info.evaluateEnd)||date(info.steps?.evaluateEnd)});
}
export function normalizeMoocCourse(row) {
  const id=numberId(row.id),termId=numberId(row.termPanel?.id);
  if (typeof row.name !== 'string' || !row.name.trim() || typeof row.schoolPanel?.shortName !== 'string') throw new Error('MOOC 课程结构变化');
  return {id:`${id}:${termId}`,courseId:id,termId,title:row.name.trim(),school:row.schoolPanel.shortName,
    fromTermId:row.termPanel.mode === 10 && row.termPanel.fromTermId ? numberId(row.termPanel.fromTermId) : null};
}
export function moocActivities(term,course) {
  if (!term || !Array.isArray(term.chapters)) throw new Error('MOOC 测验与作业列表结构变化');
  const termId=numberId(term.id),out=[];
  for (const chapter of term.chapters) {
    for (const [key,kind] of [['quizs','exam'],['homeworks','homework']]) {
      if (chapter[key] != null && !Array.isArray(chapter[key])) throw new Error('MOOC 栏目结构变化');
      for (const lesson of chapter[key] || []) {
        const test=lesson.test;if (!test || lesson.visible === false || chapter.visible === false || chapter.published === false) continue;
        const id=numberId(test.id);
        if (typeof test.name !== 'string' || !test.name.trim()) throw new Error('MOOC 事项缺少标题');
        out.push({platform:'mooc',sourceId:`spoc:${course.id}:${termId}:${kind}:${id}`,title:test.name.trim(),course:course.title,
          sourceKind:kind,sourceState:moocState(test,kind),dueAt:parseDeadline(test.deadline > 0 ? test.deadline : null),
          sourceUrl:`${MOOC_ORIGIN}/spoc/learn/${encodeURIComponent(course.school)}-${course.courseId}?tid=${course.termId}#/learn/testlist`});
      }
    }
  }
  return [...new Map(out.map(row=>[row.sourceId,row])).values()];
}
export async function collectMoocAssignments({request,signal,onCourses=()=>{},isCourseEnabled=()=>true,onProgress=()=>{}}) {
  const check=()=>{if(signal?.aborted)throw failure('cancelled','采集已取消');};
  const call=async(path,params)=>{check();const raw=await request(path,params);check();if(raw?.failure)throw failure(raw.failure,'MOOC 查询未能完成');return raw;};
  const courses=new Map();let complete=false;
  onProgress({phase:'courses',total:0,completed:0});
  for(let p=1;p<=125;p++) {
    const result=await call(COURSE_API,{type:30,p,psize:32,courseType:2});
    if(!Array.isArray(result?.result) || !result.pagination || !Number.isInteger(result.pagination.totlePageCount)) throw failure('shape','MOOC 课程列表结构变化');
    const before=courses.size;
    for(const row of result.result){const course=normalizeMoocCourse(row);courses.set(course.id,course);}
    if(courses.size>1000)throw failure('limit','MOOC 课程超过读取上限');
    if(p>=result.pagination.totlePageCount){complete=true;break;}
    if(courses.size===before)throw failure('pagination','MOOC 分页未向后推进');
  }
  if(!complete)throw failure('limit','MOOC 课程分页超过读取上限');
  check();onCourses([...courses.values()].map(({id,title})=>({id,title})));
  const selected=[...courses.values()].filter(c=>isCourseEnabled(c.id)),assignments=[],errors=[];let completed=0;
  for(const course of selected){
    check();onProgress({phase:'activities',total:selected.length,completed});
    for(const termId of [...new Set([course.termId,course.fromTermId].filter(Boolean))]) {
      try {
        const result=await call(TERM_API,{termId});
        if(String(result?.mocTermDto?.id)!==termId)throw failure('shape','MOOC 学期标识不一致');
        const activities=moocActivities(result.mocTermDto,course);
        for(const a of activities)if(a.sourceKind==='homework') {
          a.homeworkProgress=moocHomeworkProgress({});a.sourceState='unknown';
          a.sourceUrl=a.sourceUrl.split('#')[0]+'#/learn/hw?id='+a.sourceId.split(':').at(-1);
          try {
            const info=await call(HOMEWORK_API,{tid:a.sourceId.split(':').at(-1),aid:null,isDraft:false,appId:0});
            a.homeworkProgress=moocHomeworkProgress(info);
            a.sourceState=homeworkState(a.homeworkProgress);
            a.dueAt=taskDueAt(a);
            if(!info.steps||['submission','peerReview'].some(k=>a.homeworkProgress[k]==='unknown'))errors.push({course:course.id,term:termId,code:'homework_steps'});
          }catch(error){check();if(error.code==='login_required')throw error;errors.push({course:course.id,term:termId,code:'homework_status'});}
        }
        assignments.push(...activities);
        if(assignments.length>MAX_TASKS)throw failure('limit','MOOC 事项超过读取上限');
      } catch(error){check();if(error.code==='login_required'||error.code==='limit')throw error;errors.push({course:course.id,term:termId,code:error.code||'shape'});}
    }
    completed++;onProgress({phase:'activities',total:selected.length,completed});
  }
  return {assignments:[...new Map(assignments.map(a=>[a.sourceId,a])).values()],discovered:courses.size,courses:selected.length,skipped:courses.size-selected.length,completed,errors,complete:!errors.length};
}
// Runs inside the official page. Only task metadata crosses back to the application.
export async function readMoocList(path,params) {
  const coursePath='/web/j/learnerCourseRpcBean.getMyLearnedCoursePanelList.rpc',termPath='/web/j/courseBean.getLastLearnedMocTermDto.rpc',homeworkPath='/web/j/mocQuizRpcBean.getOpenHomeworkInfo.rpc';
  if(location.origin!=='https://www.icourse163.org'||![coursePath,termPath,homeworkPath].includes(path))return{failure:'unsafe_request'};
  for(let i=0;i<20&&!window.webUser?.id;i++)await new Promise(r=>setTimeout(r,250));
  if(!window.webUser?.id)return{failure:'login_required'};
  const transport=window.NEJ?.P('nej.j');if(typeof transport?._$request!=='function')return{failure:'shape'};
  const raw=await new Promise(resolve=>{
    const timer=setTimeout(()=>resolve({failure:'network'}),18000);
    const signed=path===homeworkPath;
    transport._$request(path,{method:'POST',type:'json',headers:{'Content-Type':signed?'application/json;charset=UTF-8':'application/x-www-form-urlencoded'},isNeedAuth:signed,data:signed?JSON.stringify(params):new URLSearchParams(params).toString(),timeout:15000,
      onload:value=>{clearTimeout(timer);resolve(value);},onerror:()=>{clearTimeout(timer);resolve({failure:'network'});}});
  });
  if(raw?.failure)return raw;
  if(raw?.code!==0||!raw.result)return{failure:[-200,-100,401,403].includes(raw?.code)?'login_required':'service'};
  const result=raw.result;
  if(path===homeworkPath){
    const Cache=window.NEJ?.P('edu.d')?._$$COM_Cache_HomeworkCache;
    if(typeof Cache!=='function')return{failure:'shape'};
    const steps=await new Promise(resolve=>{
      const cache=new Cache();let timer;
      const finish=value=>{clearTimeout(timer);cache._$clearEvent?.('onGetEvaluateStatus');resolve(value);};
      timer=setTimeout(()=>finish(null),15000);
      cache._$addEvent('onGetEvaluateStatus',value=>finish(value?Object.fromEntries(['stepSubmitted','stepEvaluated','stepSelfEvaluated','testEnd','evaluateStart','evaluateEnd'].map(k=>[k,value[k]])):null));
      try{cache._$getEvaluateStatus(params.tid,window.webUser.id);}catch{finish(null);}
    });
    if(!steps)return{failure:'homework_steps'};
    return{deadline:result.deadline,evaluateStart:result.evaluateStart,evaluateEnd:result.evaluateEnd,steps};
  }
  if(path===coursePath) {
    if(!Array.isArray(result.result))return{failure:'shape'};
    return{pagination:{totlePageCount:result.pagination?.totlePageCount,totleCount:result.pagination?.totleCount},result:result.result.map(c=>({id:c.id,name:c.name,termPanel:{id:c.termPanel?.id,mode:c.termPanel?.mode,fromTermId:c.termPanel?.fromTermId},schoolPanel:{shortName:c.schoolPanel?.shortName}}))};
  }
  const term=result.mocTermDto;
  if(!Array.isArray(term?.chapters))return{failure:'shape'};
  const keys=['id','name','deadline','usedTryCount','userSubmitStatus'];
  return{mocTermDto:{id:term.id,chapters:term.chapters.map(ch=>({published:ch.published,visible:ch.visible,...Object.fromEntries(['quizs','homeworks'].map(k=>[k,Array.isArray(ch[k])?ch[k].map(lesson=>({visible:lesson.visible,test:lesson.test?Object.fromEntries(keys.filter(k=>Object.hasOwn(lesson.test,k)).map(k=>[k,lesson.test[k]])):null})):ch[k]]))}))}};
}
