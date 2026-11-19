import {BrandIcon} from './BrandIcon';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {dayKey,isTaskDone,taskDueAt,PLATFORMS} from '../shared/model.mjs';
import {taskCourseEnabled} from '../shared/course-preferences.mjs';
import {bridge} from './bridge';
import {PlatformMark} from './PlatformMark';
import {Pin,EyeOff,ChevronLeft,ChevronRight,CheckCheck,Check} from './icons';
import type {Snapshot,WidgetRect} from './types';

function WidgetPopover({kind,open,bounds,children}:{kind:'rows'|'calendar';open:boolean;bounds?:WidgetRect|null;children:React.ReactNode}) {
  const [frame,setFrame]=useState<WidgetRect|null>(null);
  const ref=useRef<HTMLDivElement>(null),motion=useRef<Animation|null>(null);
  useLayoutEffect(()=>{if(open&&bounds)setFrame(bounds);},[open,bounds?.x,bounds?.y,bounds?.width,bounds?.height]);
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
    const interrupted=motion.current?.playState==='running'||motion.current?.playState==='paused';
    const current=getComputedStyle(el);
    const from=interrupted?{opacity:current.opacity,transform:current.transform}:open?{opacity:0,transform:'translateY(4px) scale(0.96,0.9)'}:{opacity:1,transform:'none'};
    motion.current?.cancel();motion.current=null;
    if(reduced){if(!open)setFrame(null);return;}
    const animation=el.animate([from,open?{opacity:1,transform:'none'}:{opacity:0,transform:'translateY(4px) scale(0.98,0.94)'}],{duration:open?240:160,easing:'cubic-bezier(0.16,1,0.3,1)',fill:'both'});
    motion.current=animation;
    animation.onfinish=()=>{if(!open)setFrame(null);else animation.cancel();if(motion.current===animation)motion.current=null;};
  },[open,!!frame]);
  useLayoutEffect(()=>()=>motion.current?.cancel(),[]);
  if(!frame)return null;
  return <div ref={ref} id={kind==='rows'?'widget-rows-menu':'widget-calendar'} className={`widget-popover ${kind==='rows'?'widget-rows-menu':'widget-calendar'}`} style={{left:frame.x,top:frame.y,width:frame.width,height:frame.height}} role={kind==='rows'?'menu':'dialog'} aria-label={kind==='rows'?'展示待办条数':'选择待办日期'} aria-hidden={!open} inert={!open} data-state={open?'open':'closing'} data-widget-popup>{children}</div>;
}

export default function Widget() {
  const [state,setState]=useState<Snapshot|null>(null),[error,setError]=useState('');
  const [now,setNow]=useState(Date.now());
  const [popover,setPopover]=useState<'rows'|'calendar'|null>(null);
  const [month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
  useEffect(()=>{
    let active=true,received=false;
    const off=bridge.onUpdate(next=>{received=true;if(active)setState(next);});
    bridge.load().then(next=>{if(active&&!received)setState(next);}).catch(()=>{if(active)setError('数据尚未加载');});
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>{active=false;off();clearInterval(timer);};
  },[]);
  useEffect(()=>{const mode=state?.themeMode||'system';if(mode==='system')delete document.documentElement.dataset.nativeTheme;else document.documentElement.dataset.nativeTheme=mode;},[state?.themeMode]);
  const widget=state?.widget,date=widget?.date||dayKey(),isToday=date===dayKey();
  const collapseDirection=widget?.collapseDirection||widget?.edge||'right';
  const collapseRotation={left:180,right:0,top:-90,bottom:90}[collapseDirection];
  const collapseLabel={left:'向左收起',right:'向右收起',top:'向上收起',bottom:'向下收起'}[collapseDirection];
  useEffect(()=>{
    if(!popover)return;
    const close=(event:PointerEvent)=>{if(!(event.target as HTMLElement).closest('[data-widget-popup]')){setPopover(null);void bridge.setWidgetPopover(null).catch(()=>{});}};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setPopover(null);void bridge.setWidgetPopover(null).catch(()=>{});}};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[popover]);
  useEffect(()=>{if(widget?.collapsed||widget?.enabled===false)setPopover(null);},[widget?.collapsed,widget?.enabled]);
  const daily=(state?.tasks||[]).filter(t=>!t.deleted&&taskCourseEnabled(state?.coursePreferences,t)).map(t=>({...t,dueAt:taskDueAt(t,now)})).filter(t=>t.dueAt&&dayKey(t.dueAt)===date);
  const pending=daily.filter(t=>!isTaskDone(t)).sort((a,b)=>Date.parse(a.dueAt!)-Date.parse(b.dueAt!)||a.id.localeCompare(b.id));
  const run=(action:Promise<void>)=>{setError('');void action.catch(e=>setError(e.message||'操作未完成'));};
  const selectDate=(key:string)=>{setPopover(null);run(bridge.selectWidgetDate(key));};
  const shift=(offset:number)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+offset);selectDate(dayKey(d));};
  const togglePopover=(kind:'rows'|'calendar')=>{
    const next=popover===kind?null:kind;
    if(next==='calendar'){const d=new Date(`${date}T12:00:00`);setMonth(new Date(d.getFullYear(),d.getMonth(),1));}
    const trigger=document.querySelector(kind==='rows'?'.widget-rows-trigger':'.widget-date-trigger')!.getBoundingClientRect(),card=document.querySelector('.desktop-widget')!.getBoundingClientRect();
    setPopover(next);run(bridge.setWidgetPopover(next,{x:trigger.left-card.left,y:trigger.bottom-card.top,width:trigger.width}));
  };
  const card=widget?.cardFrame, popup=widget?.popoverBounds;
  return <><main className={`desktop-widget ${widget?.collapsed?'is-collapsed':''}`} data-ready={!!state} data-motion={widget?.motion||''} data-edge={widget?.edge||''} aria-label="归序桌面待办" style={{...(card?{position:'absolute',left:card.x,top:card.y,width:card.width,height:card.height}:{}),'--widget-width':`${widget?.expandedBounds?.width||380}px`,'--widget-height':`${widget?.expandedBounds?.height||194}px`} as React.CSSProperties}>
    <div className="widget-content">
      <header className="widget-header"><div className="widget-drag"><BrandIcon size={24}/><strong>归序</strong><span>桌面待办</span></div><button className="icon-button widget-collapse" title={`收起小组件（${collapseLabel}）`} aria-label="收起小组件" data-direction={collapseDirection} onClick={()=>{setPopover(null);run(bridge.collapseWidget());}}><ChevronRight size={17} style={{transform:`rotate(${collapseRotation}deg)`}}/></button><button className={`icon-button ${widget?.pinned?'is-pinned':''}`} title={widget?.pinned?'取消固定':'固定小组件'} aria-label={widget?.pinned?'取消固定':'固定小组件'} aria-pressed={!!widget?.pinned} onClick={()=>run(bridge.pinWidget(!widget?.pinned))}><Pin size={17}/></button><button className="icon-button" title="隐藏小组件" aria-label="隐藏小组件" onClick={()=>{setPopover(null);run(bridge.hideWidget());}}><EyeOff size={18}/></button></header>
      <nav className="widget-date" aria-label="小组件日期"><button className="icon-button" aria-label="前一天" onClick={()=>shift(-1)}><ChevronLeft size={14}/></button><button className="widget-date-trigger" aria-label="选择日期" aria-expanded={popover==='calendar'} aria-controls="widget-calendar" data-widget-popup onClick={()=>togglePopover('calendar')}><strong>{new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN',{month:'long',day:'numeric'})} · {new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN',{weekday:'short'})}</strong></button><button className="icon-button" aria-label="后一天" onClick={()=>shift(1)}><ChevronRight size={14}/></button><button className={`text-button widget-today ${isToday?'is-today':''}`} aria-current={isToday?'date':undefined} onClick={()=>selectDate('today')}>今天</button><span>{pending.length} 项</span></nav>
      <div className="widget-list" aria-label="当日未完成待办">
        {pending.map(t=><button key={t.id} className="widget-task" data-task-id={t.id} onClick={()=>run(bridge.openWidgetTask(t.id))} title={`打开详情：${t.title}`}><strong>{t.title}</strong><div className="widget-task-meta">{t.course&&<span className="widget-course" title={t.course}>{t.course}</span>}<time dateTime={t.dueAt!}>{new Date(t.dueAt!).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})} 截止</time><span className="widget-platform" title={PLATFORMS[t.platform].name}><PlatformMark id={t.platform} small/>{PLATFORMS[t.platform].name}</span></div></button>)}
        {!pending.length&&<div className="widget-empty" role="status"><CheckCheck size={22}/><span>{!state?'数据尚未加载':daily.length?(isToday?'今天已全部完成':'当天已全部完成'):'暂无待办'}</span></div>}
      </div>
      <footer className="widget-footer"><span role="status" title={error}>{error|| (widget?.mainClosed?'主窗口已关闭':'点击待办查看详情')}</span><button className="widget-rows-trigger" data-widget-popup aria-haspopup="menu" aria-expanded={popover==='rows'} aria-controls="widget-rows-menu" onClick={()=>togglePopover('rows')}>显示{widget?.rows||5}条</button></footer>
    </div>
  </main>
      <WidgetPopover kind="rows" open={popover==='rows'&&widget?.popover==='rows'&&!!popup&&!widget?.collapsed&&widget?.enabled!==false} bounds={popup}>{([1,3,5,10] as const).map(rows=><button key={rows} role="menuitemradio" aria-checked={(widget?.rows||5)===rows} onClick={()=>{setPopover(null);run(bridge.setWidgetRows(rows));}}><span>显示{rows}条</span>{(widget?.rows||5)===rows&&<Check size={13}/>}</button>)}</WidgetPopover>
      <WidgetPopover kind="calendar" open={popover==='calendar'&&widget?.popover==='calendar'&&!!popup&&!widget?.collapsed&&widget?.enabled!==false} bounds={popup}>
        <header><button className="icon-button" aria-label="上个月" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft size={14}/></button><strong>{month.getFullYear()} 年 {month.getMonth()+1} 月</strong><button className="icon-button" aria-label="下个月" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight size={14}/></button></header>
        <div className="widget-calendar-grid">{['一','二','三','四','五','六','日'].map(day=><span key={day}>{day}</span>)}{Array.from({length:42},(_,i)=>{
          const d=new Date(month.getFullYear(),month.getMonth(),1-((month.getDay()+6)%7)+i),key=dayKey(d);
          return <button key={key} aria-label={key} aria-pressed={key===date} aria-current={key===dayKey()?'date':undefined} className={`${key===date?'selected':''} ${d.getMonth()!==month.getMonth()?'muted':''}`} onClick={()=>selectDate(key)}>{d.getDate()}</button>;
        })}</div><button className="widget-calendar-today" onClick={()=>selectDate('today')}>回到今天</button>
      </WidgetPopover>
  </>;
}
