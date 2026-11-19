export function validateProgrammingInfo(value) {
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new Error('编程练习信息格式不正确');
  const result={};
  for(const key of ['openAt','discountAt','closeAt']) {
    const date=value[key]??null;
    if(date!==null&&(typeof date!=='string'||!Number.isFinite(Date.parse(date))||new Date(date).toISOString()!==date))throw new Error('编程练习日期格式不正确');
    result[key]=date;
  }
  const discountFactor=value.discountFactor??null,allowLate=value.allowLate??null,total=value.total??null,passed=value.passed??null;
  if(discountFactor!==null&&(!Number.isFinite(discountFactor)||discountFactor<0||discountFactor>1))throw new Error('编程练习折扣不正确');
  if(allowLate!==null&&typeof allowLate!=='boolean')throw new Error('编程练习迟交设置不正确');
  if([total,passed].some(n=>n!==null&&(!Number.isInteger(n)||n<0||n>100000))||((total===null)!==(passed===null))||passed>total)throw new Error('编程练习评测数量不正确');
  return{...result,discountFactor,allowLate,total,passed};
}
