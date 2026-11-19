import {BrandIcon} from './BrandIcon';
import {createPortal,flushSync} from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Sun, Moon, LayoutGrid, CalendarDays, CheckCheck, Plus, Search, ChevronLeft, ChevronRight, ChevronDown, ArrowUpRight, RefreshCw, Cloud, Download, Upload, Settings2, X, Check, BookOpen, MoreHorizontal, Clock3, CircleHelp, Link2, LogOut, ArrowRight, Inbox, ShieldCheck, ListTodo, WifiOff, Sparkles, Trash } from './icons';
import type { FluentIcon } from './icons';
import { PLATFORMS, taskSourceState, taskSourceLabel, taskDueAt, taskDisplayTitle, isTaskDone, isTaskOverdue, dayKey, importAssignments, importJSON, mergeTasks, mutateTask, parseICS, validateTasks, taskAccountVisible, scoreTag } from '../shared/model.mjs';
import {taskCourseEnabled,taskCourseId} from '../shared/course-preferences.mjs';
import { bridge, desktop } from './bridge';
import {PlatformMark} from './PlatformMark';
import {UniMark} from './UniMark';import {SyncDialog} from './SyncDialog';
import type { Task, Platform, Snapshot, Connection } from './types';

const platformIds: Platform[] = ['yanhe', 'lexue', 'mooc', 'zhihuishu'];
const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
const today = () => dayKey();
const localInput = (value: string | null) => { if (!value) return ''; const d = new Date(value); return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dateLabel = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'});
const authLabels: Record<string, string> = {none: '尚未登录', checking: '正在核验', signed_in: '已登录', expired: '登录已过期', renewing: '正在恢复登录', verification_required: '需要重新登录', network: '网络不可达', service_error: '暂无法核验', account_mismatch: '账号不一致', unsafe_redirect: '恢复已停止'};
function connectionLabel(id: Platform, connection?: Connection) {return connection?.auth ? authLabels[connection.auth.state] : connection?.saved ? '已保存会话' : '未连接';}

function SelectionHighlight({className,visible,style}:{className:string;visible:boolean;style:React.CSSProperties}) {
  const ref=useRef<HTMLSpanElement>(null);
  const [positioned,setPositioned]=useState(false);
  useLayoutEffect(()=>{
    if(!visible){setPositioned(false);return;}
    const el=ref.current!;
    // Position the outer box without interpolation, then expand only its fill.
    el.getBoundingClientRect();
    const animation=matchMedia('(prefers-reduced-motion:reduce)').matches?null:el.firstElementChild!.animate([{transform:'scale(0)',opacity:0},{transform:'scale(1)',opacity:1}],{duration:200,easing:'cubic-bezier(0.2,0,0,1)'});
    const frame=requestAnimationFrame(()=>setPositioned(true));
    return()=>{cancelAnimationFrame(frame);animation?.cancel();};
  },[visible]);
  return <span ref={ref} aria-hidden="true" className={className} style={{...style,opacity:visible?1:0,...(!positioned?{transition:'none'}:{})}}><span className="selection-highlight-fill"/></span>;
}

function DateSelectionIndicator({selection,selector}:{selection:string;selector:string}) {
  const ref=useRef<HTMLSpanElement>(null);
  const [box,setBox]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  useLayoutEffect(()=>{
    const parent=ref.current?.parentElement;if(!parent)return;
    const update=()=>{const target=parent.querySelector<HTMLElement>(selector);if(!target){setBox(null);return;}
      const rect=target.getBoundingClientRect(),base=parent.getBoundingClientRect();setBox({x:rect.left-base.left+parent.scrollLeft,y:rect.top-base.top+parent.scrollTop,width:rect.width,height:rect.height});};
    update();const resize=new ResizeObserver(update);resize.observe(parent);return()=>resize.disconnect();
  },[selection,selector]);
  return <span ref={ref} className="date-indicator-anchor" aria-hidden="true"><SelectionHighlight className="date-selection-indicator" visible={!!box} style={box?{transform:`translate(${box.x}px, ${box.y}px)`,width:box.width,height:box.height}:{}}/></span>;
}

export default function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [view, setView] = useState('day');
  const [selected, setSelected] = useState(today());
  const dateContentRef=useRef<HTMLDivElement>(null);
  const dateMotionRef=useRef<Animation|null>(null);
  const weekMotionRef=useRef<Animation|null>(null);
  const dateSequence=useRef(0);
  const [dateAnimating,setDateAnimating]=useState(false);
  const [month, setMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all');
  const [courseFilter,setCourseFilter]=useState('all');
  const [taskMenu,setTaskMenu]=useState<{id:string;anchor:HTMLButtonElement}|null>(null);
  const [taskTransitions,setTaskTransitions]=useState<Record<string,{before:Task;after:Task}>>({});
  const [layoutBusy,setLayoutBusy]=useState<Set<string>>(new Set());
  const transitionLocks=useRef(new Set<string>());
  const layoutAnimations=useRef(new Map<HTMLElement,Animation>());
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [detailId,setDetailId]=useState<string|null>(null);
  const [modal, setModal] = useState<'sync' | 'import' | 'help' | 'appearance' | 'credential' | 'recycle' | null>(null);
  const [settingsAnchor,setSettingsAnchor]=useState<HTMLButtonElement|null>(null);
  const [darkTheme,setDarkTheme]=useState(false);
  const [courseSelection, setCourseSelection] = useState<Platform | null>(null);
  const [toast, setToast] = useState(''); const [busy, setBusy] = useState('');
  const [showOverdue, setShowOverdue] = useState(true);
  const [fatal, setFatal] = useState('');
  const sidebarRef=useRef<HTMLElement>(null);
  const [navIndicator,setNavIndicator]=useState({top:0,height:16,visible:false});
  useLayoutEffect(()=>{
    const sidebar=sidebarRef.current;if(!sidebar)return;
    const update=()=>{const selected=sidebar.querySelector<HTMLElement>('[aria-current="page"]');if(!selected){setNavIndicator(old=>({...old,visible:false}));return;}const bounds=selected.getBoundingClientRect(),parent=sidebar.getBoundingClientRect();setNavIndicator({top:bounds.top-parent.top+sidebar.scrollTop+(bounds.height-16)/2,height:16,visible:true});};
    update();const observer=new ResizeObserver(update);observer.observe(sidebar);sidebar.addEventListener('scroll',update);return()=>{observer.disconnect();sidebar.removeEventListener('scroll',update);};
  },[view,filter,!!state]);
  const stateRef = useRef(state); stateRef.current = state;
  const notify = (message: string) => setToast(message);
  const clearSavedPassword = async () => {try {await bridge.clearCredential();notify('已清除本机保存的统一认证密码');} catch (e) {notify((e as Error).message);}};
  useEffect(() => {
    bridge.load().then(setState).catch(e => setFatal(String(e.message || e)));
    return bridge.onUpdate(setState);
  }, []);
  useEffect(()=>{
    const open=(id:string)=>{setEditing(null);setTaskMenu(null);setModal(null);setCourseSelection(null);setDetailId(id);};
    const off=bridge.onOpenTask(open);
    const offNew=bridge.onNewTask?.(()=>{setEditing('new');setTaskMenu(null);setDetailId(null);setCourseSelection(null);setModal(null);});
    void bridge.taskReady().then(id=>{if(id)open(id);}).catch(()=>{});
    return()=>{off();offNew?.();};
  },[]);
  useEffect(()=>{if(desktop)return;const mode=state?.themeMode||'system';if(mode==='system')delete document.documentElement.dataset.nativeTheme;else document.documentElement.dataset.nativeTheme=mode;},[state?.themeMode]);
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)');
    const update=()=>setDarkTheme(document.documentElement.dataset.nativeTheme==='dark'||!document.documentElement.dataset.nativeTheme&&media.matches);
    update();const observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-native-theme']});media.addEventListener('change',update);
    return()=>{observer.disconnect();media.removeEventListener('change',update);};
  },[]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t); } }, [toast]);
  async function persist(tasks: Task[]) {
    if (!stateRef.current) return;
    try { await bridge.saveTasks(tasks); setState(s => s ? {...s, tasks: mergeTasks(s.tasks, tasks) as Task[]} : s); }
    catch (e) { notify(`保存失败：${(e as Error).message}`); throw e; }
  }
  async function edit(patch: Partial<Task>) { if (state) await persist(mutateTask(stateRef.current!.tasks, patch, state.device) as Task[]); }
  async function restoreRecycled(id: string) {try {await edit({id, deleted: false});notify('已恢复，移回原来的列表');} catch (e) {notify((e as Error).message);}}
  async function changeDate(key:string,toDay=false) {
    if(key===selected&&!dateMotionRef.current&&(!toDay||view==='day'))return;
    const direction=key<selected?-1:1;
    const sequence=++dateSequence.current;
    const outgoing=dateContentRef.current;
    const start=outgoing?getComputedStyle(outgoing).transform:'none';
    dateMotionRef.current?.cancel();dateMotionRef.current=null;
    const weekOutgoing=document.querySelector<HTMLElement>('.week-dates');
    const weekStart=weekOutgoing?getComputedStyle(weekOutgoing).transform:'none';
    weekMotionRef.current?.cancel();weekMotionRef.current=null;
    const monday=(value:string)=>{const date=new Date(`${value}T12:00:00`);date.setDate(date.getDate()-(date.getDay()+6)%7);return dayKey(date);};
    const crossesWeek=monday(key)!==monday(selected);
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||!outgoing){if(outgoing)outgoing.inert=false;setSelected(key);if(toDay)setView('day');setDateAnimating(false);return;}
    setDateAnimating(true);outgoing.inert=true;
    const animate=async(el:HTMLElement,frames:Keyframe[],easing:string)=>{
      const animation=el.animate(frames,{duration:200,easing,fill:'both'});dateMotionRef.current=animation;
      await animation.finished.catch(()=>{});return animation;
    };
    try {
      if(crossesWeek&&weekOutgoing)weekMotionRef.current=weekOutgoing.animate([{transform:weekStart},{transform:`translateX(${-direction*(weekOutgoing.clientWidth+40)}px)`}],{duration:200,easing:'cubic-bezier(0.55,0,1,0.45)',fill:'both'});
      const exit=await animate(outgoing,[{transform:start},{transform:`translateX(${-direction*(outgoing.clientWidth+40)}px)`}],'cubic-bezier(0.55,0,1,0.45)');
      if(weekMotionRef.current)await weekMotionRef.current.finished.catch(()=>{});
      if(sequence!==dateSequence.current)return;
      if(!outgoing.isConnected)return;
      flushSync(()=>{setSelected(key);if(toDay)setView('day');});
      const incoming=dateContentRef.current;if(!incoming)return;
      incoming.inert=true;
      // Install the incoming first frame before releasing the outgoing fill.
      const entry=animate(incoming,[{transform:`translateX(${direction*(incoming.clientWidth+40)}px)`},{transform:'translateX(0px)'}],'cubic-bezier(0.2,0,0,1)');
      const weekIncoming=document.querySelector<HTMLElement>('.week-dates');
      if(crossesWeek&&weekIncoming){const old=weekMotionRef.current;weekMotionRef.current=weekIncoming.animate([{transform:`translateX(${direction*(weekIncoming.clientWidth+40)}px)`},{transform:'translateX(0px)'}],{duration:200,easing:'cubic-bezier(0.2,0,0,1)',fill:'both'});old?.cancel();}
      exit.cancel();await entry;
      if(weekMotionRef.current)await weekMotionRef.current.finished.catch(()=>{});
    } finally {
      if(sequence===dateSequence.current){(dateMotionRef.current as Animation|null)?.cancel();dateMotionRef.current=null;(weekMotionRef.current as Animation|null)?.cancel();weekMotionRef.current=null;outgoing.inert=false;if(dateContentRef.current)dateContentRef.current.inert=false;setDateAnimating(false);}
    }
  }
  async function animateTaskEdit(patch:Partial<Task>) {
    const before=stateRef.current?.tasks.find(t=>t.id===patch.id);
    if(!before||transitionLocks.current.has(before.id))return;
    transitionLocks.current.add(before.id);
    const after={...before,...patch};
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const previousSurfaces=new Map([...document.querySelectorAll<HTMLElement>('.task-card')].filter(el=>el.dataset.taskId===before.id).map(card=>[card,{
      background:getComputedStyle(card.querySelector('.task-status-background')!).backgroundColor,
      foreground:getComputedStyle(card.querySelector('.task-status-foreground')!).backgroundColor
    }]));
    flushSync(()=>setTaskTransitions(old=>({...old,[before.id]:{before,after}})));
    const cards=[...document.querySelectorAll<HTMLElement>('.task-card')].filter(el=>el.dataset.taskId===before.id);
    const animations:Animation[]=[];
    const play=(el:Element|null,frames:Keyframe[],duration=240,easing='cubic-bezier(0.2,0,0,1)',reverse=false,delay=0)=>{
      if(!el)return;const animation=el.animate(frames,{duration:reduced?0:duration,delay:reduced?0:delay,easing,direction:reverse?'reverse':'normal',fill:'both'});animations.push(animation);return animation.finished.catch(()=>{});
    };
    const leaves=after.deleted||isTaskDone(before)!==isTaskDone(after);
    const effectiveAfter={...after,dueAt:taskDueAt(after)};
    const staysOnPage=!after.deleted&&(view==='completed'?isTaskDone(after):
      (isTaskDone(after)||showOverdue||!isTaskOverdue(after))&&
      (!(view==='day'||view==='calendar')||!!effectiveAfter.dueAt&&(dayKey(effectiveAfter.dueAt)===selected||view==='day'&&selected===today()&&dayKey(effectiveAfter.dueAt)<selected&&!isTaskDone(after)&&isTaskOverdue(after))));
    const motion=(async()=>{
      await Promise.all(cards.flatMap(card=>{
        const effects=[];
        const undoCompletion=patch.completed===false&&before.completed&&!isTaskDone(after);
        if(patch.completed===true&&!after.ignored||undoCompletion){
          const box=card.getBoundingClientRect(),circle=card.querySelector('.task-check')!.getBoundingClientRect();
          const x=circle.x+circle.width/2-box.x,y=circle.y+circle.height/2-box.y;
          const radius=Math.hypot(Math.max(x,box.width-x),Math.max(y,box.height-y));
          const color=undoCompletion?previousSurfaces.get(card)?.background:undefined;
          effects.push(play(card.querySelector('.task-status-background'),[{...(color?{backgroundColor:color}:{}),clipPath:`circle(0px at ${x}px ${y}px)`},{...(color?{backgroundColor:color}:{}),clipPath:`circle(${radius}px at ${x}px ${y}px)`}],240,undefined,undoCompletion));
          effects.push(play(card.querySelector('.task-check svg'),[{clipPath:'inset(0 100% 0 0)',opacity:0},{clipPath:'inset(0 0 0 0)',opacity:1}],240,undefined,undoCompletion));
        } else if(patch.ignored===false&&before.ignored) {
          const color=previousSurfaces.get(card)?.foreground||'transparent';
          effects.push(play(card.querySelector('.task-status-foreground'),[{backgroundColor:color,opacity:0},{backgroundColor:color,opacity:1}],240,undefined,true));
        } else {
          effects.push(play(card.querySelector(after.ignored&&!after.deleted?'.task-status-foreground':'.task-status-background'),[{opacity:0},{opacity:1}]));
        }
        if(after.deleted)effects.push(play(card.querySelector('.task-strike'),[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],240,'cubic-bezier(0.32,0.08,0.18,1)'));
        return effects;
      }));
      if(leaves){
        if(staysOnPage)await Promise.all(cards.map(card=>play(card,[{opacity:1},{opacity:1}],0,undefined,false,80)));
        else await Promise.all(cards.map(card=>play(card,[{transform:'translateX(0)',opacity:1},{transform:`translateX(-${card.offsetWidth+32}px)`,opacity:0}],200,'cubic-bezier(0.55,0,1,0.45)',false,80)));
      }
    })();
    try {const [saved]=await Promise.allSettled([edit(patch),motion]);if(saved.status==='rejected')throw saved.reason;}
    finally {
      const layoutElements=()=>[...document.querySelectorAll<HTMLElement>('.task-card,.task-section > .section-heading,.completed-empty')];
      const layoutKey=(el:HTMLElement)=>el.dataset.taskId?`task:${el.dataset.taskId}`:`${el.parentElement?.getAttribute('aria-label')}:${el.classList.contains('section-heading')?'heading':'empty'}`;
      // Capture actual on-screen positions, including any in-progress reflow.
      const previous=new Map(layoutElements().map(el=>[layoutKey(el),el.getBoundingClientRect()]));
      for(const [el,animation] of layoutAnimations.current){animation.cancel();el.classList.remove('is-layout-moving');}
      layoutAnimations.current.clear();
      // Keep the final outgoing frame until its old card has been removed.
      flushSync(()=>{setLayoutBusy(old=>new Set(old).add(before.id));setTaskTransitions(old=>{const next={...old};delete next[before.id];return next;});});
      animations.forEach(a=>a.cancel());
      const moving=layoutElements().map(el=>({el,from:previous.get(layoutKey(el)),to:el.getBoundingClientRect()}));
      await Promise.all(moving.map(async({el,from,to})=>{
        if(!from||reduced)return;
        const x=from.left-to.left,y=from.top-to.top;if(Math.abs(x)<0.5&&Math.abs(y)<0.5)return;
        el.classList.add('is-layout-moving');
        const animation=el.animate([{transform:`translate(${x}px, ${y}px)`},{transform:'translate(0px, 0px)'}],{duration:240,easing:'cubic-bezier(0.2,0,0,1)',fill:'both'});
        layoutAnimations.current.set(el,animation);
        await animation.finished.catch(()=>{});
        if(layoutAnimations.current.get(el)===animation){layoutAnimations.current.delete(el);animation.cancel();el.classList.remove('is-layout-moving');}
      }));
      transitionLocks.current.delete(before.id);
      setLayoutBusy(old=>{const next=new Set(old);next.delete(before.id);return next;});
    }
  }
  const [phaseClock,setPhaseClock]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setPhaseClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const active = useMemo(() => state?.tasks.map(t=>taskTransitions[t.id]?.before||t).filter(t => taskAccountVisible(t, state?.accounts) && !t.deleted && taskCourseEnabled(state?.coursePreferences,t)).map(t=>({...t,dueAt:taskDueAt(t)})) || [], [state,phaseClock,taskTransitions]);
  const platformTasks=active.filter(t=>filter==='all'||t.platform===filter);
  const courseKey=(task:Task)=>JSON.stringify([task.platform,taskCourseId(task)]);
  const courseOptions=[...new Map(platformTasks.filter(t=>taskCourseId(t)).map(t=>{const id=taskCourseId(t),catalog=state?.coursePreferences?.catalog[t.platform]?.find(c=>c.id===id);return [courseKey(t),{key:courseKey(t),title:catalog?.title||t.course,platform:t.platform}];})).values()].sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
  const selectedCourse=courseOptions.some(c=>c.key===courseFilter)?courseFilter:'all';
  const scoped=platformTasks.filter(t=>selectedCourse==='all'||courseKey(t)===selectedCourse);
  const allPending=active.filter(t=>!isTaskDone(t));
  const pending = scoped.filter(t => !isTaskDone(t));
  const overdue = pending.filter(t => isTaskOverdue(t));
  const daily = scoped.filter(t => t.dueAt && dayKey(t.dueAt) === selected);
  const completion = daily.length ? Math.round(daily.filter(t => isTaskDone(t)).length / daily.length * 100) : 0;
  const filtered = scoped.filter(t => !query || `${t.title} ${t.course} ${t.notes}`.toLowerCase().includes(query.toLowerCase()));
  const sorted = (tasks: Task[]) => [...tasks].sort((a, b) => +isTaskDone(a) - +isTaskDone(b) || (a.dueAt || 'z').localeCompare(b.dueAt || 'z'));
  const onSelectedDay=(t:Task)=>!!t.dueAt&&dayKey(t.dueAt)===selected;
  const visible = sorted(filtered.filter(t => view === 'completed' ? isTaskDone(t) : !isTaskDone(t)&&(showOverdue||!isTaskOverdue(t))&&(!(view==='day'||view==='calendar')||onSelectedDay(t))));
  const completedVisible=sorted(filtered.filter(t=>isTaskDone(t)&&(!(view==='day'||view==='calendar')||onSelectedDay(t))));
  const priorOverdue = showOverdue?sorted(filtered.filter(t => isTaskOverdue(t) && t.dueAt && dayKey(t.dueAt) < today())):[];
  const recycled = useMemo(() => (state?.tasks || []).filter(t => t.deleted && taskAccountVisible(t, state?.accounts))
    .sort((a, b) => Date.parse(b.deletedAt || b.updatedAt) - Date.parse(a.deletedAt || a.updatedAt)), [state]);

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id); try { await work(); } catch (e) { notify((e as Error).message); } finally { setBusy(''); }
  }
  async function scan(id: Platform) {
    await run(id, async () => { const result = await bridge.scan(id); if (result.assignments.length) await persist(importAssignments(stateRef.current!.tasks, result.assignments, stateRef.current!.device) as Task[]); notify(result.message); });
  }
  async function importText(text: string, name = '') {
    if (!state) return;
    const data = name.endsWith('.ics') || text.trim().startsWith('BEGIN:VCALENDAR') ? {assignments: parseICS(text)} : importJSON(text);
    const tasks = 'backup' in data && data.backup ? mergeTasks(stateRef.current!.tasks, validateTasks(data.backup)) : importAssignments(stateRef.current!.tasks, data.assignments, state.device);
    await persist(tasks as Task[]); setModal(null); notify('已导入并保存待办');
  }
  async function demo() {
    if (!state) return;
    const due = (offset: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
    const examples = [
      {title: '完成第三章课后习题', course: '高等数学 A', platform: 'lexue', dueAt: due(0, 23)},
      {title: '整理二叉树与遍历笔记', course: '数据结构与算法', platform: 'manual', dueAt: due(0, 20)},
      {title: '提交实验二：进程调度', course: '操作系统', platform: 'yanhe', dueAt: due(1, 22)},
      {title: '观看第 6 周课程并完成测验', course: '大学英语', platform: 'mooc', dueAt: due(2, 23)},
      {title: '完成章节测试', course: '大学生心理健康', platform: 'zhihuishu', dueAt: due(3, 18)},
      {title: '小组讨论：确定展示主题', course: '课程项目', platform: 'manual', dueAt: due(0, 19)}
    ].map((a, i) => ({...a, sourceId: `demo-${i}`, notes: '演示任务，用于体验界面。可在帮助中一键清除。'}));
    await persist(importAssignments(stateRef.current!.tasks, examples, state.device) as Task[]); notify('已添加 6 条演示任务（非平台真实数据）');
  }
  const nav = (id: string, label: string, Icon: FluentIcon, count?: number) => <button className={`nav-item ${view === id && filter==='all' ? 'active' : ''}`} title={label} aria-current={view===id&&filter==='all'?'page':undefined} onClick={() => {setView(id);setFilter('all');setCourseFilter('all');if(id==='day')setSelected(today());}}><Icon size={19}/><span>{label}</span>{count !== undefined && <span className="nav-count">{count}</span>}</button>;
  const renderTask = (task: Task) => {
    const transitioning=taskTransitions[task.id];
    const taskBusy=!!transitioning||layoutBusy.has(task.id);
    if(transitioning)task={...transitioning.after,dueAt:taskDueAt(transitioning.after)};
    const done = isTaskDone(task);
    const title = taskDisplayTitle(task);
    const late = isTaskOverdue(task);
    const sourceLabel = taskSourceLabel(task);
    const sourceState = taskSourceState(task);
    const dueLabel = task.dueAt ? `${view !== 'day' && (view === 'all' || view === 'completed' || dayKey(task.dueAt) !== selected) ? dayKey(task.dueAt) + ' ' : ''}${new Date(task.dueAt).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit', hour12:false})}` : task.homeworkProgress ? '待核验' : '无日期';
    return <article key={task.id} data-task-id={task.id} aria-busy={taskBusy} className={`task-card ${task.deleted?'is-recycled':task.ignored ? 'is-ignored' : done ? 'is-complete' : late ? 'is-expired' : ''} ${transitioning?'is-transitioning':''}`}>
      <span className="task-status-background" aria-hidden="true"/><span className="task-status-foreground" aria-hidden="true"/>
      <button className={`task-check ${done&&!task.ignored ? 'checked' : ''}`} disabled={taskBusy||sourceState === 'submitted'&&!task.ignored} title={sourceState === 'submitted' ? '平台已确认提交' : undefined} aria-label={task.ignored ? `取消忽略 ${title}` : task.completed ? `取消完成 ${title}` : `完成 ${title}`} onClick={() => void animateTaskEdit(task.ignored?{id:task.id,ignored:false}:{id: task.id, completed: !task.completed}).catch(() => {})}>{(done&&!task.ignored||transitioning?.before.completed&&!transitioning.before.ignored&&transitioning.after.completed===false&&!done) && <Check size={14} strokeWidth={3}/>}</button>
      <button className="task-body" disabled={taskBusy} onClick={() => setDetailId(task.id)}><span className="task-title"><span className="task-title-text">{title}<i className="task-strike" aria-hidden="true"/></span></span><span className="task-meta"><span className="task-tag platform-tag" style={{color: PLATFORMS[task.platform].color}}>{PLATFORMS[task.platform].name}</span>{task.course && <span className="task-tag course-tag" title={task.course}><BookOpen size={11}/>{task.course}</span>}{task.sourceKind && <span className="source-kind">{task.programmingInfo ? '编程练习' : task.sourceKind === 'exam' ? '测试' : '作业'}</span>}{task.score && <span className="score-tag" title={`成绩 ${scoreTag(task.score)}`}>{scoreTag(task.score)}</span>}{task.ignored && <span className="source-state ignored-state">已忽略</span>}{!task.ignored && sourceLabel && <span className={`source-state source-${sourceState}`}>{sourceLabel}</span>}{task.notes.startsWith('演示任务') && <span className="demo-tag">演示</span>}</span></button>
      <span title={task.dueAt ? new Date(task.dueAt).toLocaleString('zh-CN', {hour12:false}) : undefined} className={`task-time ${late ? 'late' : ''}`}><Clock3 size={13}/>{task.homeworkProgress && <span>{task.homeworkProgress.submission==='done' && Date.now()>=Date.parse(task.homeworkProgress.submissionDeadline || '')?'批改':'提交'} </span>}{task.programmingInfo && <span>{task.programmingInfo.discountAt?'折扣':'关闭'} </span>}{dueLabel}</span>
      <button className="icon-button task-more" disabled={taskBusy} title="更多操作" aria-label={`更多操作 ${title}`} aria-haspopup="menu" aria-expanded={taskMenu?.id===task.id} onClick={e=>{const anchor=e.currentTarget;setTaskMenu(old=>old?.id===task.id?null:{id:task.id,anchor});}}><MoreHorizontal size={18}/></button>
    </article>;
  };
  const detailTask=state?.tasks.find(t=>t.id===detailId&&!t.deleted);
  if (fatal) return <div className="fatal"><h1>无法读取本地数据</h1><p>{fatal}</p><p>为保护已有任务，程序没有覆盖数据。请备份应用数据目录后重试。</p></div>;
  if (!state) return <div className="loading"><div className="brand-symbol"><BrandIcon/></div><p>正在整理你的每一天…</p></div>;
  return <div className={`app-shell ${desktop ? 'native-window' : ''}`}>
    <div className="titlebar"><span className="titlebar-name">归序 · DDL 收纳</span>{!desktop && <span className="preview-pill">浏览器预览</span>}</div>
    <aside className="sidebar" ref={sidebarRef} aria-label="主导航"><SelectionHighlight className="navigation-indicator" visible={navIndicator.visible} style={{transform:`translateY(${navIndicator.top}px)`,height:navIndicator.height}}/>
      <div className="brand"><div className="brand-symbol"><BrandIcon/></div><div><strong>归序<span>Duefold</span></strong><small>让截止日，井井有条</small></div></div>
      <label className="search-box"><Search size={16}/><input aria-label="搜索待办" placeholder="搜索待办、课程…" value={query} onChange={e => {setQuery(e.target.value); if (view === 'connections') setView('all');}}/></label>
      <nav>{nav('day', '今日待办', Sun, allPending.filter(t => t.dueAt && dayKey(t.dueAt) === today()).length)}{nav('all', '全部待办', LayoutGrid, allPending.length)}{nav('calendar', '日历视图', CalendarDays)}{nav('completed', '已完成', CheckCheck, active.filter(t => isTaskDone(t)).length)}</nav>
      <div className="sidebar-heading"><span>学习平台</span><button className="icon-button" aria-label="管理平台连接" title="管理平台连接" aria-current={view==='connections'?'page':undefined} onClick={() => setView('connections')}><Link2 size={14}/></button></div>
      <div className="platform-nav">{platformIds.map(id => <button key={id} className={`platform-nav-item ${filter === id && view==='all' ? 'selected' : ''}`} title={PLATFORMS[id].name} aria-label={PLATFORMS[id].name} aria-current={filter===id&&view==='all'?'page':undefined} onClick={() => {setView('all'); setFilter(id);setCourseFilter('all');}}><PlatformMark id={id} small/><span>{PLATFORMS[id].name}</span><span className={`connection-dot ${(state.connections[id]?.auth ? state.connections[id]?.auth?.state === 'signed_in' : state.connections[id]?.saved) ? 'connected' : ''}`} title={connectionLabel(id, state.connections[id])}/></button>)}</div>
      <div className="sidebar-bottom"><div className="local-note"><ShieldCheck size={17}/><span>登录凭据仅保存在本机</span></div><button aria-label="设置" title="设置" aria-haspopup="menu" aria-expanded={!!settingsAnchor} onClick={e=>setSettingsAnchor(settingsAnchor?null:e.currentTarget)}><Settings2 size={18}/><span>设置</span><small>v0.1.9</small></button></div>
    </aside>
    {settingsAnchor&&<PopupMenu anchor={settingsAnchor} label="设置" className="settings-menu" onClose={()=>setSettingsAnchor(null)}>
      <button role="menuitem" onClick={()=>{setSettingsAnchor(null);setView('connections');}}><Link2 size={18}/><span>管理平台连接</span></button>
      <button role="menuitem" onClick={()=>{setSettingsAnchor(null);setModal('appearance');}}>{darkTheme?<Moon size={18}/>:<Sun size={18}/>}<span>外观设置</span></button>
      <button role="menuitem" onClick={()=>{setSettingsAnchor(null);setModal('sync');}}><Cloud size={18}/><span>多端同步</span><span className={`status-dot ${state.syncStatus==='已同步'?'on':''}`}/></button>
      <button role="menuitem" onClick={()=>{setSettingsAnchor(null);setModal('import');}}><Upload size={18}/><span>导入与备份</span></button>
      {desktop&&<button role="menuitemcheckbox" aria-checked={!!state.widget?.enabled} title={state.widget?.enabled?'隐藏桌面小组件':'显示桌面小组件'} onClick={()=>void bridge.configureWidget({enabled:!stateRef.current?.widget?.enabled}).catch(e=>notify(e.message))}><LayoutGrid size={18}/><span>桌面小组件</span>{state.widget?.enabled&&<Check className="widget-enabled-check" size={16}/>}</button>}
      <button role="menuitem" onClick={()=>{setSettingsAnchor(null);setModal('recycle');}}><Trash size={18}/><span>回收站</span>{recycled.length>0&&<span className="menu-count">{recycled.length}</span>}</button>
      <button role="menuitem" onClick={()=>{setSettingsAnchor(null);setModal('help');}}><CircleHelp size={18}/><span>使用帮助</span></button>
      {desktop&&<><div className="menu-separator" role="separator"/><button role="menuitem" onClick={()=>bridge.windowControl('quit')}><LogOut size={18}/><span>退出归序</span></button></>}
    </PopupMenu>}
    <div className="workspace">
      <main key={`${view}:${filter}`} className={`main-content ${view === 'connections' ? 'wide' : view==='calendar'?'calendar-main':''}`}>
        {view==='calendar'?<MonthCalendar expanded month={month} selected={selected} tasks={active} onMonth={setMonth} onDate={key=>void changeDate(key,true)} onToday={()=>{setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1));void changeDate(today(),true);}}/>:<>
        <header className="page-header"><div><div className="eyebrow">{view === 'connections' ? 'CONNECTED LEARNING' : 'A LITTLE MORE ORGANIZED'}</div><h1>{view === 'connections' ? '连接你的学习世界' : view === 'all' ? (platformIds.includes(filter as Platform) ? `${PLATFORMS[filter as Platform].name} · 全部待办` : '每一件事，都有着落') : view === 'completed' ? '每一份努力，都算数' : view === 'calendar' ? '未来的安排，一目了然' : '把今天，安排得刚刚好'}<span className="heading-dot">.</span></h1><p>{view === 'connections' ? '把分散在各处的截止日，带到同一个地方。' : `${dateLabel(selected)}${selected === today() ? ' · 今天也按自己的节奏来' : ' · 提前留一点从容'}`}</p></div></header>
        {view !== 'connections' && <div className="top-actions"><button className="sync-button" aria-label="多端同步" title="多端同步" onClick={() => setModal('sync')}><Cloud size={16}/><span>{state.syncStatus}</span></button><button className="primary-button" onClick={() => setEditing('new')}><Plus size={17}/>新建待办</button></div>}
        {view === 'connections' ? <>
          <div className="connection-info"><ShieldCheck size={22}/><div><p>登录状态使用系统加密，仅在本地保存</p></div></div>
          <section className="campus-credential" aria-label="北京理工大学统一身份认证">
            <div className="campus-credential-text"><UniMark size={26}/><div><strong>北京理工大学统一身份认证（延河 & 乐学）</strong><p>保存密码后，无需反复重复登录</p>{state.credential?.saved && <small>已保存{state.credential.username ? `：${state.credential.username}` : ''}{state.credential.failures ? ` · 连续失败 ${state.credential.failures} 次` : ''}{state.credential.auto === false ? ' · 自动重新登录已暂停' : ''}</small>}</div></div>
            <label className="campus-credential-toggle"><input type="checkbox" checked={!!state.credential?.saved} onChange={e => {if (e.target.checked) setModal('credential');else void clearSavedPassword();}}/><span>保存密码</span></label>
          </section>
          <div className="connection-grid">{platformIds.map(id => {
            const connection = state.connections[id];const auth = connection?.auth;
            const healthy = auth ? auth.state === 'signed_in' : connection?.saved;
            const needsLogin = connection?.collection?.needsLogin || auth && ['expired','verification_required','unsafe_redirect'].includes(auth.state);
            const checking = auth && ['checking','renewing'].includes(auth.state);
            return <section className="connection-card" data-platform={id} key={id}>
              <div className="connection-card-head"><PlatformMark id={id}/><span className={`connection-badge ${healthy ? 'saved' : auth ? 'auth-' + auth.state : ''}`}>{connectionLabel(id, connection)}</span></div>
              <h2>{PLATFORMS[id].name}</h2><p className="connection-description">{id === 'yanhe' || id === 'lexue' ? '北京理工大学统一身份认证' : '在官方登录页面完成账号验证'}</p>
              {['yanhe','lexue','mooc'].includes(id) && <div className="auth-summary" role="status"><ShieldCheck size={14}/><p>{auth?.message || '登录后自动读取课程列表及每门课的作业与测试；过期时尝试复用统一认证。'}</p></div>}
              {auth?.checkedAt && <small className="last-scan">最近核验 {new Date(auth.checkedAt).toLocaleString('zh-CN')}</small>}
              {auth?.expiresAt && <small className="last-scan">令牌到期 {new Date(auth.expiresAt).toLocaleString('zh-CN')}</small>}
              <div className="connection-result">{connection?.detail || (['yanhe','mooc','lexue'].includes(id) ? '完成官方登录后自动读取课程与事项，可在“选择课程”中排除不需要的课程。' : '尚未适配')}</div>
              {connection?.lastScan && <small className="last-scan">最近读取 {new Date(connection.lastScan).toLocaleString('zh-CN')}</small>}
              <div className="connection-actions">
                <button className="secondary-button" onClick={() => setCourseSelection(id)}><BookOpen size={14}/>选择课程{state.coursePreferences?.catalog[id]?.length ? ` (${state.coursePreferences.catalog[id]!.length})` : ''}</button>
                <button className="primary-button" disabled={!!busy || !!checking} onClick={() => void run(id, async () => notify(await bridge.login(id)))}><ArrowUpRight size={15}/>{needsLogin ? '重新登录' : connection?.saved || healthy ? '打开平台' : '登录平台'}</button>
                <button className="secondary-button" disabled={!!busy || !!checking || connection?.collection?.running} onClick={() => void scan(id)}><RefreshCw size={14} className={busy === id || connection?.collection?.running ? 'spin' : ''}/>{['yanhe','mooc','lexue'].includes(id) ? connection?.collection?.running ? '自动读取中' : '立即刷新' : '读取作业'}</button>
                {(connection?.saved || !!auth) && <button className="icon-button" title="退出登录" aria-label={`退出登录${PLATFORMS[id].name}`} onClick={() => void run(id, async () => {await bridge.disconnect(id); notify(`已退出${PLATFORMS[id].name}登录，待办保留`);})}><LogOut size={16}/></button>}
              </div>
            </section>;
          })}</div>
          <div className="notice-panel"><CircleHelp size={18}/><p>自动读取受平台页面和账号权限影响。读取失败或只读取当前页面时会明确提示；也可以导入平台的 ICS 日历，或手动补充待办。学校账号与密码不会上传到同步服务器。</p></div>
        </> : <>
          <div className="summary-strip"><div><span className="summary-icon green"><ListTodo size={20}/></span><span><strong>{pending.length}<small> 项</small></strong><label>待完成</label></span></div><div><span className="summary-icon amber"><Clock3 size={20}/></span><span><strong>{pending.filter(t => t.dueAt && new Date(t.dueAt).getTime() > Date.now() && new Date(t.dueAt).getTime() < Date.now() + 3 * 86400000).length}<small> 项</small></strong><label>三天内截止</label></span></div><div><span className="summary-icon lavender"><CheckCheck size={20}/></span><span><strong>{scoped.filter(t => isTaskDone(t)).length}<small> 项</small></strong><label>已经完成</label></span></div></div>
          {(view === 'day' || view === 'calendar') && <div className="week-picker"><button className="icon-button" title="上一周" onClick={() => { const d = new Date(`${selected}T12:00:00`); d.setDate(d.getDate() - 7); void changeDate(dayKey(d)); }}><ChevronLeft size={16}/></button><div className="week-dates-viewport"><div className="week-dates"><DateSelectionIndicator selection={selected} selector=".week-day.active"/>{Array.from({length: 7}, (_, i) => {const d = new Date(`${selected}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i); const k = dayKey(d); const count = pending.filter(t => t.dueAt && dayKey(t.dueAt) === k).length; return <button key={k} onClick={() => void changeDate(k)} className={`week-day ${k === selected ? 'active' : ''} ${k === today() ? 'is-today' : ''}`}><span>周{weekdays[d.getDay()]}</span><strong>{d.getDate()}</strong><i className={count ? 'has-tasks' : ''}/></button>;})}</div></div><button className="icon-button" title="下一周" onClick={() => {const d = new Date(`${selected}T12:00:00`); d.setDate(d.getDate() + 7); void changeDate(dayKey(d));}}><ChevronRight size={16}/></button></div>}
          <div className="date-content-viewport"><div className="date-content" ref={dateContentRef} aria-busy={dateAnimating}>
          <div className="list-toolbar">{view !== 'day' && <div className="list-tabs"><select aria-label="按课程筛选" value={selectedCourse} onChange={e => setCourseFilter(e.target.value)}><option value="all">全部课程</option>{courseOptions.map(c=><option key={c.key} value={c.key}>{c.title}{filter==='all' ? ` · ${PLATFORMS[c.platform].name}` : ''}</option>)}</select></div>}{view !== 'completed' && <label className="show-completed"><input type="checkbox" checked={showOverdue} onChange={e => setShowOverdue(e.target.checked)}/>显示已逾期</label>}</div>
          {view === 'day' && selected === today() && priorOverdue.length > 0 && <section className="task-section" aria-label="此前已逾期"><div className="section-heading"><span className="overdue-label"><span className="tiny-dot"/>此前已逾期</span><span className="count-pill">{priorOverdue.length}</span><small>仍然可以继续完成</small></div><div className="task-list overdue-list">{priorOverdue.map(renderTask)}</div></section>}
          <section className="task-section" aria-label={view==='completed'?'已完成':'未完成'}><div className="section-heading"><h2>{query ? '搜索结果' : view === 'completed' ? '已完成的待办' : view === 'all' ? '所有待办' : selected === today() ? '今天的安排' : dateLabel(selected)}</h2><span className="count-pill">{visible.length}</span>{(view === 'day' || view === 'calendar') && selected !== today() && <button className="text-button" onClick={() => void changeDate(today())}>回到今天</button>}</div>
            {visible.length ? <div className="task-list">{visible.map(renderTask)}</div> : view!=='completed'&&completedVisible.length>0 ? <p className="completed-empty">暂无未完成的待办</p> : <div className="empty-state"><div className="empty-illustration"><div className="empty-paper"><span/><span/><span/><div><Check size={22}/></div></div><Sparkles className="empty-spark" size={19}/><i/></div><h3>{query ? '还没有找到匹配的待办' : view === 'completed' ? '每完成一件事，就离目标近一点' : active.length ? '这一天，留一点空间给自己' : '你的每一天，从这里开始'}</h3><p>{query ? '试试其他关键词，或检查筛选条件。' : active.length ? '当前日期和筛选条件下没有待办。' : '连接学习平台，或记下第一件要做的事。'}</p>{!query && <div className="empty-actions"><button className="secondary-button" onClick={() => setView('connections')}><Link2 size={15}/>连接学习平台</button><button className="text-button" onClick={() => setEditing('new')}>手动添加<ArrowRight size={14}/></button></div>}</div>}
            {view !== 'all' && (view !== 'day' || !visible.length && !completedVisible.length && (selected !== today() || !priorOverdue.length)) && <button className="add-inline" onClick={() => setEditing('new')}><Plus size={17}/>添加一件要做的事<span>留住每一个小计划</span></button>}
          </section>
          {view!=='completed'&&<section className="task-section" aria-label="已完成"><div className="section-heading"><h2>已完成</h2><span className="count-pill">{completedVisible.length}</span></div>{completedVisible.length?<div className="task-list">{completedVisible.map(renderTask)}</div>:<p className="completed-empty">暂无已完成的待办</p>}</section>}
          <div className="daily-footer"><span className="tiny-dot"/>每一步小小的完成，都在让生活变得有序。<span>Duefold / 归序</span></div>
          </div></div>
        </>}
        </>}
      </main>
      {view !== 'connections' && view !== 'calendar' && <aside className="right-panel"><MonthCalendar month={month} selected={selected} tasks={active} onMonth={setMonth} onDate={key=>void changeDate(key,true)} onToday={()=>{setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1));void changeDate(today(),true);}}/>
        <div className="progress-card"><div className="small-heading"><h3>{selected === today() ? '今日进度' : '当日进度'}</h3><span>{daily.filter(t => isTaskDone(t)).length} / {daily.length}</span></div><div className="progress-track"><div style={{width: `${completion}%`}}/></div><p>{daily.length ? completion === 100 ? '全部完成，给自己一个小奖励。' : '不着急，一件一件慢慢来。' : '留出空间，也是一种好安排。'}</p></div>
        <div className="upcoming-card"><div className="small-heading"><h3>接下来的截止日</h3><CalendarDays size={15}/></div>{sorted(pending.filter(t => t.dueAt && dayKey(t.dueAt) > today())).slice(0, 3).map(t => <button className="upcoming-item" key={t.id} onClick={() => void changeDate(dayKey(t.dueAt!),true)}><span className="upcoming-date"><strong>{new Date(t.dueAt!).getDate()}</strong><small>{new Date(t.dueAt!).getMonth() + 1} 月</small></span><span><strong>{taskDisplayTitle(t)}</strong><small>{t.course || PLATFORMS[t.platform].name}</small></span><ChevronRight size={14}/></button>)}{!pending.some(t => t.dueAt && dayKey(t.dueAt) > today()) && <div className="upcoming-empty"><Inbox size={25}/><p>还没有接下来的安排</p></div>}</div>
        {!active.length && <div className="getting-started"><span className="tip-label"><Sparkles size={13}/>第一次见面</span><h3>先感受一下归序</h3><p>添加几条演示待办，看看截止日聚在一起的样子。</p><button onClick={() => void demo().catch(() => {})}>体验演示数据<ArrowRight size={14}/></button></div>}
      </aside>}
    </div>
    {detailTask && <TaskDetailsDialog task={detailTask} onClose={()=>setDetailId(null)} onEdit={()=>{setDetailId(null);setEditing(detailTask);}} onAction={async action=>{setDetailId(null);try{await animateTaskEdit(action==='delete'?{id:detailTask.id,deleted:true}:{id:detailTask.id,ignored:!detailTask.ignored});notify(action==='delete'?'已移入回收站':detailTask.ignored?'已取消忽略':'已忽略，归入“已完成”目录');}catch{}}}/>}
    {editing && <TaskDialog task={editing} selected={selected} onClose={() => setEditing(null)} onSave={async patch => {await edit(patch);setEditing(null);notify('待办已保存');}} onDelete={async id => {setEditing(null);await animateTaskEdit({id, deleted: true});notify('已移入回收站');}}/>}
    {taskMenu && <TaskActionMenu anchor={taskMenu.anchor} task={state.tasks.find(t=>t.id===taskMenu.id)!} onClose={()=>setTaskMenu(null)} onAction={async action=>{const task=stateRef.current!.tasks.find(t=>t.id===taskMenu.id);setTaskMenu(null);if(!task)return;if(action==='edit'){setEditing(task);return;}try{await animateTaskEdit(action==='delete'?{id:task.id,deleted:true}:{id:task.id,ignored:!task.ignored});notify(action==='delete'?'已移入回收站':task.ignored?'已取消忽略':'已忽略，归入“已完成”目录');}catch{}}}/>}
    {modal === 'appearance' && <Modal title="外观设置" subtitle="选择适合你的明暗风格，设置会保存在这台设备。" onClose={()=>setModal(null)}><div className="theme-options" role="radiogroup" aria-label="明暗模式">{([{id:'light',label:'浅色',description:'白色背景 · 蓝色强调'},{id:'dark',label:'深色',description:'黑色背景 · 金色强调'},{id:'system',label:'跟随系统',description:'随系统自动选择浅色或深色'}] as const).map(option=><label className="theme-option" key={option.id}><input type="radio" name="theme-mode" aria-label={option.label} value={option.id} checked={(state.themeMode||'system')===option.id} onChange={()=>void bridge.setTheme(option.id).then(()=>setState(old=>old?{...old,themeMode:option.id}:old)).catch(e=>notify(`外观设置保存失败：${e.message}`))}/><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></Modal>}
    {modal === 'recycle' && <Modal title="回收站" subtitle="删除的待办会保留在这里，恢复后回到原来的列表。" dismissOnBackdrop onClose={() => setModal(null)}><div>{recycled.length ? <ul className="recycle-list">{recycled.map(task => <li key={task.id}><div><strong>{taskDisplayTitle(task)}</strong><p>{PLATFORMS[task.platform].name}{task.course ? ` · ${task.course}` : ''} · 删除于 {new Date(task.deletedAt || task.updatedAt).toLocaleString('zh-CN', {hour12:false})}</p></div><button type="button" className="secondary-button" aria-label={`恢复 ${taskDisplayTitle(task)}`} onClick={() => void restoreRecycled(task.id)}>恢复</button></li>)}</ul> : <p className="recycle-empty">回收站是空的。删除的待办会保留在这里。</p>}<p className="recycle-note">删除记录同时作为多端同步的标记保留，因此这里暂不提供彻底删除。</p></div></Modal>}
    {modal === 'credential' && <Modal title="保存统一认证密码" subtitle="只保存在本机加密库；延河登录过期时用于后台重新登录。" onClose={() => setModal(null)}><CredentialDialog state={state} notify={notify} onClose={() => setModal(null)}/></Modal>}
    {modal === 'sync' && <Modal title="让每一端，保持同一步调" subtitle="选择同步服务，离线修改会在重连后合并。" onClose={() => setModal(null)}><SyncDialog state={state} onClose={() => setModal(null)} notify={notify}/></Modal>}
    {courseSelection && <CourseSelectionDialog id={courseSelection} state={state} onClose={() => setCourseSelection(null)} onSave={async excluded => {await bridge.configureCourses(courseSelection, excluded);setCourseSelection(null);notify('课程选择已保存，未勾选课程的待办已隐藏，重新勾选即可恢复');}}/>}
    {modal === 'import' && <ImportDialog onClose={() => setModal(null)} onImport={importText} onExport={async () => {if (await bridge.exportData(JSON.stringify({schema: 1, exportedAt: new Date().toISOString(), tasks: state.tasks}, null, 2))) notify('备份已导出，不包含账号登录凭据');}}/>}
    {modal === 'help' && <Modal title="你好，欢迎使用归序" subtitle="把分散的截止日，安放在每一天。" onClose={() => setModal(null)}><div className="help-content"><p><strong>1. 连接平台</strong><br/>在“管理平台连接”中登录。延河、乐学与 MOOC 会自动更新课程列表并读取已勾选课程的事项；MOOC 读取 SPOC 课程。乐学可复用北理工认证，读取作业、测验和编程练习；智慧树按当前页面读取。点击“选择课程”排除不需要的课程。</p><p><strong>2. 安排每一天</strong><br/>新建待办可填写课程、日期和备注。点击圆圈完成，点击标题编辑；日历可以切换日期。</p><p><strong>3. 同步到其他设备</strong><br/>在“多端同步”选择 Supabase Cloud，用用户名和邀请码首次加入；新设备输入用户名发起申请，再在已登录设备手工输入新设备显示的 6 位码批准。每个账号最多 4 台活跃设备，可查看和撤销设备；全部设备丢失请联系管理员生成恢复码。也可选择“自建服务”填写相同地址与密钥。只同步待办，不同步学校登录会话；关闭同步会保留本机待办与云端身份。当前交付 Windows 版。</p><p><strong>提醒与版本范围</strong><br/>当前版本没有后台系统通知，请定期查看列表。平台接口与完整课程覆盖仍需真实账号联调，未读取到任务不代表没有作业。</p><button className="secondary-button" onClick={async () => {let tasks = stateRef.current!.tasks; for (const t of tasks.filter(t => !t.deleted && t.notes.startsWith('演示任务'))) tasks = mutateTask(tasks, {id: t.id, deleted: true}, state.device) as Task[]; await persist(tasks); notify('演示任务已清除');}}>清除演示任务</button></div></Modal>}
    {toast && <div role="status" className="toast"><span><Check size={16}/></span>{toast}<button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><X size={14}/></button></div>}
  </div>;
}

function TaskActionMenu({anchor,task,onClose,onAction}:{anchor:HTMLButtonElement;task:Task;onClose:()=>void;onAction:(action:'edit'|'delete'|'ignore')=>Promise<void>}) {
  return <PopupMenu anchor={anchor} label={`${taskDisplayTitle(task)}的操作`} onClose={onClose}><button role="menuitem" onClick={()=>void onAction('edit')}>编辑</button><button role="menuitem" className="delete-action" onClick={()=>void onAction('delete')}>删除</button><button role="menuitem" onClick={()=>void onAction('ignore')}>{task.ignored?'取消忽略':'忽略'}</button></PopupMenu>;
}
function PopupMenu({anchor,label,className='',onClose,children}:{anchor:HTMLButtonElement;label:string;className?:string;onClose:()=>void;children:React.ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:0,top:0});
  useLayoutEffect(()=>{
    const menu=ref.current!;
    const position=()=>{const rect=anchor.getBoundingClientRect(),height=menu.offsetHeight,width=menu.offsetWidth;setPosition({left:Math.max(8,Math.min(rect.right-width,innerWidth-width-8)),top:rect.bottom+height+4<=innerHeight?rect.bottom+4:Math.max(8,rect.top-height-4)});};
    position();menu.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const outside=(e:PointerEvent)=>{if(!menu.contains(e.target as Node)&&!anchor.contains(e.target as Node))onClose();};
    const key=(e:KeyboardEvent)=>{const items=[...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];const index=items.indexOf(document.activeElement as HTMLElement);
      if(e.key==='Escape'){e.preventDefault();onClose();anchor.focus();}
      if(e.key==='Tab')onClose();
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
    };
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);if(menu.contains(document.activeElement))anchor.focus();};
  },[]);
  return createPortal(<div className={`task-action-menu ${className}`} role="menu" aria-label={label} ref={ref} style={position}>{children}</div>,document.body);
}
function CredentialDialog({state, notify, onClose}: {state: Snapshot; notify: (message: string) => void; onClose: () => void}) {
  const saved = !!state.credential?.saved;
  const [username, setUsername] = useState(state.credential?.username || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<void>) => {setBusy(true);setError('');try {await work();} catch (e) {setError((e as Error).message);} finally {setBusy(false);}};
  return <div className="credential-dialog">
    <p className="credential-note">延河与乐学共用同一个北京理工大学统一身份认证。保存后，延河登录过期时归序会用它在后台重新登录；乐学会话过期时也会用它换取新的 Moodle 会话。密码使用 Windows 系统加密（DPAPI）保存在本机，不进入待办、同步或导出；遇到短信验证或图形验证码时仍必须由你在官方窗口完成。取消勾选“保存密码”或点“清除”即可删除。</p>
    <label className="field">学号 / 用户名<input maxLength={128} autoComplete="username" placeholder="例如：1120200000" value={username} onChange={e => setUsername(e.target.value)}/></label>
    <label className="field">统一认证密码<input type="password" maxLength={256} autoComplete="current-password" placeholder={saved ? '留空表示不修改已保存的密码' : '仅保存在本机加密库'} value={password} onChange={e => setPassword(e.target.value)}/></label>
    {saved && <p className="credential-status">已保存{state.credential?.username ? `：${state.credential.username}` : ''}{state.credential?.failures ? ` · 连续失败 ${state.credential.failures} 次` : ''}{state.credential?.auto === false ? ' · 自动重新登录已暂停，重新保存可恢复' : ''}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-footer">
      {saved && <button className="danger-button" disabled={busy} onClick={() => void run(async () => {await bridge.clearCredential();setUsername('');setPassword('');notify('已清除本机保存的统一认证密码');onClose();})}>清除</button>}
      <button className="secondary-button" onClick={onClose}>取消</button>
      <button className="primary-button" disabled={busy || !username.trim() || !password} onClick={() => void run(async () => {await bridge.saveCredential({username: username.trim(), password, auto: true});setPassword('');notify('已保存统一认证密码，只保存在本机');onClose();})}>{saved ? '更新' : '保存'}</button>
    </div>
  </div>;
}
function Modal({title, subtitle, onClose, dismissOnBackdrop = false, children}: {title: string; subtitle?: string; onClose: () => void; dismissOnBackdrop?: boolean; children: React.ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {closeRef.current = onClose;});
  // Play the entrance animation backwards before unmounting, so the dialog never disappears abruptly.
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {closeRef.current();return;}
    setClosing(true);
    exitTimer.current = setTimeout(() => closeRef.current(), 200);
  };
  useEffect(() => () => {if (exitTimer.current) clearTimeout(exitTimer.current);}, []);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const background=[...document.querySelectorAll<HTMLElement>('.sidebar,.workspace,.titlebar')];
    for(const el of background)el.inert=true;
    const dialog = ref.current!; const first=dialog.querySelector<HTMLElement>('[autofocus],input:not([type=hidden]):not(:disabled),textarea:not(:disabled),button:not(:disabled)');(first||dialog).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {e.preventDefault();close();}
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(el=>el.getClientRects().length>0);
      if (!items.length) return;
      if (e.shiftKey && document.activeElement === items[0]) {e.preventDefault();items.at(-1)!.focus();}
      else if (!e.shiftKey && document.activeElement === items.at(-1)) {e.preventDefault();items[0].focus();}
    };
    document.addEventListener('keydown', key); return () => {document.removeEventListener('keydown', key);for(const el of background)el.inert=false;before?.focus();};
  }, []);
  return <div className={`modal-backdrop${closing ? ' is-closing' : ''}`} onPointerDown={dismissOnBackdrop ? event => {if (event.button === 0 && event.target === event.currentTarget) close();} : undefined}><div className={`modal${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><div className="modal-head"><button className="icon-button modal-close" aria-label="关闭对话框" onClick={close}><X size={19}/></button><h2>{title}</h2>{subtitle && <p className="modal-subtitle">{subtitle}</p>}</div>{children}</div></div>;
}
function CourseSelectionDialog({id, state, onClose, onSave}: {id: Platform; state: Snapshot; onClose: () => void; onSave: (excluded: string[]) => Promise<void>}) {
  const catalog = state.coursePreferences?.catalog[id] || [];
  const [excluded, setExcluded] = useState<string[]>(state.coursePreferences?.excluded[id] || []);
  const [search, setSearch] = useState('');const [busy, setBusy] = useState(false);const [error, setError] = useState('');
  const visible = catalog.filter(course => course.title.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = visible.filter(course => !excluded.includes(course.id)).length;
  const visibleIds = new Set(visible.map(course => course.id));
  return <Modal title={`${PLATFORMS[id].name} · 选择课程`} subtitle="只读取勾选课程的事项，新发现的课程默认勾选。" onClose={onClose}>
    <div className="course-selection-note">{['yanhe','mooc','lexue'].includes(id) ? '自动更新全部课程列表，跳过未勾选课程的作业与测试查询，缩短读取时间。' : '这里显示当前已识别到的课程；列表覆盖范围取决于该平台的读取能力。未勾选课程的事项将跳过导入。'}取消勾选后会隐藏该课程已有待办并跳过读取，重新勾选即可恢复，备注和完成记录保留。课程选择保存在当前设备。</div>
    <label className="field">搜索课程<input value={search} onChange={e => setSearch(e.target.value)} placeholder="例如：大学物理实验"/></label>
    <div className="course-selection-toolbar"><span>已勾选 {selected} / {visible.length} 门</span><button className="text-button" disabled={busy || !visible.length} onClick={() => setExcluded(old => old.filter(key => !visibleIds.has(key)))}>全部勾选</button><button className="text-button" disabled={busy || !visible.length} onClick={() => setExcluded(old => [...new Set([...old,...visibleIds])])}>全部取消</button></div>
    <div className="course-selection-list">{visible.length ? visible.map(course => <label className="course-choice" key={course.id}><input type="checkbox" checked={!excluded.includes(course.id)} onChange={e => setExcluded(old => e.target.checked ? old.filter(key => key !== course.id) : [...old,course.id])}/><span>{course.title}</span></label>) : <p className="muted-text">{catalog.length ? '没有匹配的课程。' : ['yanhe','mooc','lexue'].includes(id) ? '尚未获取课程列表。完成登录后，程序会自动获取，无需逐门打开课程。' : '尚未识别到课程。登录并读取平台后，已发现的课程会显示在这里。'}</p>}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="modal-footer"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy} onClick={async () => {setBusy(true);try {await onSave(excluded);} catch(e) {setError((e as Error).message);setBusy(false);}}}>{busy ? '保存中…' : '保存课程选择'}</button></div>
  </Modal>;
}
function MonthCalendar({month,selected,tasks,onMonth,onDate,onToday,expanded=false}:{month:Date;selected:string;tasks:Task[];onMonth:(date:Date)=>void;onDate:(key:string)=>void;onToday:()=>void;expanded?:boolean}) {
  const showToday=selected!==today()||month.getFullYear()!==new Date().getFullYear()||month.getMonth()!==new Date().getMonth();
  const byDay=new Map<string,Task[]>();
  for(const task of tasks){const due=taskDueAt(task);if(!due||task.deleted)continue;const key=dayKey(due);byDay.set(key,[...(byDay.get(key)||[]),task]);}
  return <section className={`calendar-card ${expanded?'month-overview':''}`} aria-label={expanded?'月历':'日期日历'}>
    <div className="calendar-header"><strong>{month.getFullYear()} 年 {month.getMonth()+1} 月</strong><div><button className="icon-button" aria-label="上个月" onClick={()=>onMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={16}/></button><button className="icon-button" aria-label="下个月" onClick={()=>onMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={16}/></button></div></div>
    <div className="calendar-grid"><DateSelectionIndicator selection={`${selected}:${month.getTime()}`} selector={expanded?'.calendar-date-number.is-selected':'button.selected'}/>{['一','二','三','四','五','六','日'].map(d=><span className="calendar-weekday" key={d}>{d}</span>)}
    {Array.from({length:42},(_,i)=>{const date=new Date(month.getFullYear(),month.getMonth(),1-((month.getDay()+6)%7)+i),key=dayKey(date),entries=byDay.get(key)||[],pending=entries.filter(t=>!isTaskDone(t)),done=entries.filter(t=>isTaskDone(t));
      return <button key={key} aria-label={key} aria-current={key===selected?'date':undefined} className={`${date.getMonth()!==month.getMonth()?'muted':''} ${key===selected?'selected':''} ${key===today()?'today':''}`} onClick={()=>onDate(key)}><span className={`calendar-date-number ${key===selected?'is-selected':''}`}>{date.getDate()}</span>{expanded?<span className="calendar-day-counts"><span className={`calendar-count pending-count ${pending.some(t=>isTaskOverdue(t))?'has-expired':''}`}><span>未完成</span><span>{pending.length}</span></span><span className={`calendar-count completed-count ${done.length>0&&done.every(t=>t.ignored)?'all-ignored':''}`}><span>已完成</span><span>{done.length}</span></span></span>:pending.length>0&&<i/>}</button>;
    })}</div><div className={`calendar-today-slot ${showToday?'is-open':''}`} aria-hidden={!showToday} inert={!showToday}><div><button className="calendar-today" onClick={onToday}>回到今天<ArrowRight size={14}/></button></div></div>
  </section>;
}
function TaskDetailsDialog({task,onClose,onEdit,onAction}:{task:Task;onClose:()=>void;onEdit:()=>void;onAction:(action:'delete'|'ignore')=>Promise<void>}) {
  const date=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'待核验';
  const due=taskDueAt(task);
  const status=task.ignored?'已忽略':task.completed?'已完成':isTaskOverdue(task)?'已过期':taskSourceLabel(task)||'待完成';
  return <Modal title={taskDisplayTitle(task)} onClose={onClose}><div className="task-details">
    <dl><div><dt>来源平台</dt><dd>{PLATFORMS[task.platform].name}</dd></div><div><dt>课程 / 分类</dt><dd>{task.course||'未分类'}</dd></div><div><dt>当前状态</dt><dd>{status}</dd></div><div><dt>截止时间</dt><dd>{due?date(due):task.homeworkProgress?'待核验':'无日期'}</dd></div>{task.score&&<div><dt>成绩</dt><dd>{scoreTag(task.score)}</dd></div>}</dl>
    {task.homeworkProgress&&<section className="homework-detail" aria-label="作业阶段详情"><strong>作业阶段</strong><p>提交截止：{date(task.homeworkProgress.submissionDeadline)}</p><p>批改开始：{date(task.homeworkProgress.reviewStart)}</p><p>批改截止：{date(task.homeworkProgress.reviewDeadline)}</p>{([['submission','完成并提交 作业'],['peerReview','互评 作业'],['selfReview','自评 作业']] as const).map(([key,label])=><p key={key}>{label}：{{done:'已完成',pending:'未完成',unknown:'待核验'}[task.homeworkProgress![key]]}</p>)}</section>}
    {task.programmingInfo&&<section className="homework-detail" aria-label="编程练习详情"><strong>编程练习</strong><p>开启时间：{date(task.programmingInfo.openAt)}</p><p>折扣时间：{date(task.programmingInfo.discountAt)}</p><p>最终关闭：{date(task.programmingInfo.closeAt)}</p><p>折扣系数：{task.programmingInfo.discountFactor??'待核验'}</p><p>允许迟交：{task.programmingInfo.allowLate===null?'待核验':task.programmingInfo.allowLate?'是':'否'}</p><p>评测通过：{task.programmingInfo.total===null?'待核验':`${task.programmingInfo.passed} / ${task.programmingInfo.total} 个测试用例`}</p><p>列表按折扣时间提醒；没有折扣时间时按最终关闭时间提醒。</p></section>}
    <section className="task-details-notes"><h4>备注</h4><p>{task.notes||'暂无备注'}</p></section>
    {task.sourceUrl&&<button type="button" className="text-button source-link" onClick={()=>void bridge.openExternal(task.sourceUrl)}>查看原平台<ArrowUpRight size={14}/></button>}
  </div><div className="modal-footer"><button className="secondary-button" onClick={onEdit}>编辑</button><button className="secondary-button details-delete-button" onClick={()=>void onAction('delete')}>删除</button><button className="secondary-button" onClick={()=>void onAction('ignore')}>{task.ignored?'取消忽略':'忽略'}</button></div></Modal>;
}
function TaskDialog({task, selected, onClose, onSave, onDelete}: {task: Task | 'new'; selected: string; onClose: () => void; onSave: (p: Partial<Task>) => Promise<void>; onDelete: (id: string) => Promise<void>}) {
  const existing = task === 'new' ? null : task;
  const [title, setTitle] = useState(existing?.title || ''); const [course, setCourse] = useState(existing?.course || '');
  const [due, setDue] = useState(existing ? localInput(existing.dueAt) : `${selected}T23:59`); const [notes, setNotes] = useState(existing?.notes || '');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  return <Modal title={existing ? '编辑待办' : '记下一件要做的事'} subtitle="小小的计划，也值得被认真记住。" onClose={onClose}><form onSubmit={async e => {e.preventDefault();if (!title.trim()) {setError('请填写待办标题');return;}setBusy(true);try {await onSave({...(existing ? {id: existing.id} : {}), title: title.trim(), course: course.trim(), dueAt: due ? new Date(due).toISOString() : null, notes});} catch (e) {setError((e as Error).message);} finally {setBusy(false);}}}><label className="field">待办标题<input maxLength={500} required placeholder="例如：提交高数第三章作业" value={title} onChange={e => setTitle(e.target.value)}/></label><div className="form-row"><label className="field">课程 / 分类<input maxLength={200} placeholder="选填，例如：高等数学" value={course} onChange={e => setCourse(e.target.value)}/></label><label className="field">截止日期<input type="datetime-local" value={due} onChange={e => setDue(e.target.value)}/></label></div>{existing?.homeworkProgress && <div className="homework-detail" aria-label="作业阶段详情"><strong>{taskSourceLabel(existing)}</strong><p>提交截止：{existing.homeworkProgress.submissionDeadline ? new Date(existing.homeworkProgress.submissionDeadline).toLocaleString('zh-CN', {hour12:false}) : '待核验'}</p><p>批改开始：{existing.homeworkProgress.reviewStart ? new Date(existing.homeworkProgress.reviewStart).toLocaleString('zh-CN', {hour12:false}) : '待核验'}</p><p>批改截止：{existing.homeworkProgress.reviewDeadline ? new Date(existing.homeworkProgress.reviewDeadline).toLocaleString('zh-CN', {hour12:false}) : '待核验'}</p>{([['submission','完成并提交 作业'],['peerReview','互评 作业'],['selfReview','自评 作业']] as const).map(([key,label])=><p key={key}>{label}：{{done:'已完成',pending:'未完成',unknown:'待核验'}[existing.homeworkProgress![key]]}</p>)}</div>}<label className="field">备注<textarea maxLength={10000} rows={3} placeholder="补充作业要求、提交方式…" value={notes} onChange={e => setNotes(e.target.value)}/></label>{existing?.sourceUrl && <button type="button" className="text-button source-link" onClick={() => void bridge.openExternal(existing.sourceUrl)}>查看原平台<ArrowUpRight size={14}/></button>}{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer">{existing && <button type="button" disabled={busy} className="danger-button" onClick={async () => {if (!confirmDelete) {setConfirmDelete(true);return;}setBusy(true);try {await onDelete(existing.id);} catch (e) {setError((e as Error).message);setBusy(false);}}}>{confirmDelete ? '确认删除' : '删除待办'}</button>}<span className="spacer"/><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy} type="submit">{busy ? '保存中…' : '保存待办'}</button></div></form></Modal>;
}
function ImportDialog({onClose, onImport, onExport}: {onClose: () => void; onImport: (text: string, name?: string) => Promise<void>; onExport: () => Promise<void>}) {
  const [text, setText] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  const perform = async (work: () => Promise<void>) => {setBusy(true);try {await work();} catch (e) {setError((e as Error).message);} finally {setBusy(false);}};
  return <Modal title="带进来，也安心带走" subtitle="支持归序 JSON 备份、任务数组与 ICS 日历文件。" onClose={onClose}><div className="import-options"><button className="import-option" disabled={busy} onClick={() => void perform(async () => {if (desktop) {const file = await bridge.readImport();if (file) await onImport(file.text, file.name);} else fileRef.current?.click();})}><Upload size={22}/><strong>导入文件</strong><small>JSON / ICS · 不重复添加同一来源</small></button><button className="import-option" disabled={busy} onClick={() => void perform(onExport)}><Download size={22}/><strong>导出备份</strong><small>包含全部任务及删除记录，不含凭据</small></button></div><input ref={fileRef} hidden type="file" accept=".json,.ics" onChange={e => {const file = e.target.files?.[0];if (file) void perform(async () => {if (file.size > 8 * 1024 * 1024) throw new Error('文件不能超过 8 MB');await onImport(await file.text(), file.name);});}}/><label className="field">或粘贴任务 JSON<textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={'[{"title":"提交作业","course":"高等数学",\n  "dueAt":"2026-11-20T23:59:00+08:00"}]'}/></label><p className="muted-text">无时区的导入日期按北京时间解释；在列表中按设备本地时间显示。</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-footer"><button className="secondary-button" onClick={onClose}>关闭</button><button className="primary-button" disabled={!text.trim() || busy} onClick={() => void perform(() => onImport(text))}>导入待办</button></div></Modal>;
}
