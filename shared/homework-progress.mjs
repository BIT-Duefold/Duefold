const steps=['submission','peerReview','selfReview'];
const requiredSteps=['submission','peerReview'];
export function validateHomeworkProgress(value) {
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new Error('作业阶段信息格式不正确');
  const result={};
  for(const key of steps){if(!['done','pending','unknown'].includes(value[key]))throw new Error('作业步骤状态不正确');result[key]=value[key];}
  for(const key of ['submissionDeadline','reviewStart','reviewDeadline']){
    const date=value[key]??null;
    if(date!==null&&(typeof date!=='string'||!Number.isFinite(Date.parse(date))||new Date(date).toISOString()!==date))throw new Error('作业阶段日期格式不正确');
    result[key]=date;
  }
  if(result.reviewStart&&result.reviewDeadline&&result.reviewStart>result.reviewDeadline)throw new Error('作业批改阶段时间顺序不正确');
  return result;
}
export function homeworkState(progress,now=Date.now()) {
  if(!progress)return 'unknown';
  if(requiredSteps.every(k=>progress[k]==='done'))return 'submitted';
  const end=Date.parse(progress.reviewDeadline),submit=Date.parse(progress.submissionDeadline),start=Date.parse(progress.reviewStart);
  if(progress.submission==='pending'&&Number.isFinite(submit)&&now>=submit)return 'expired';
  if(requiredSteps.some(k=>progress[k]==='unknown'))return 'unknown';
  if(Number.isFinite(end)&&now>=end)return 'expired';
  if(progress.submission!=='done')return 'unsubmitted';
  if(Number.isFinite(submit)&&now<submit)return 'awaiting_review';
  if(Number.isFinite(start)&&Number.isFinite(end)&&now>=start&&now<end)return 'review_required';
  if(Number.isFinite(start)&&now<start)return 'awaiting_review';
  return 'unknown';
}
export function taskSourceState(task,now=Date.now()) {
  return task.platform==='mooc'&&task.sourceKind==='homework'&&task.homeworkProgress?homeworkState(task.homeworkProgress,now):task.sourceState;
}
export function taskDueAt(task,now=Date.now()) {
  const p=task.platform==='mooc'&&task.sourceKind==='homework'?task.homeworkProgress:null;
  if(!p)return task.dueAt;
  if(p.submission!=='done'||now<Date.parse(p.submissionDeadline))return p.submissionDeadline||task.dueAt;
  return p.reviewDeadline;
}
export function taskSourceLabel(task,now=Date.now()) {
  if(task.platform==='lexue'&&task.programmingInfo) {
    if(taskSourceState(task,now)==='submitted')return '评测已通过';
    if(taskSourceState(task,now)==='returned')return '已提交，评测未通过';
  }
  return {submitted:'已提交',awaiting_review:'已提交，待互评',review_required:'已提交，请互评',expired:'已过期',draft:'草稿未提交',returned:'已退回',unsubmitted:'未提交'}[taskSourceState(task,now)]||(task.platform!=='manual'?'提交状态待核验':'');
}
