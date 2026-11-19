const path = require('node:path');
const {APP_ICON} = require('./branding.cjs');
const nativeFullscreen = process.platform === 'win32' ? require('./native/fullscreen-win32-x64.node') : null;

const ROWS = [1, 3, 5, 10];
const WIDTH = 380, BASE = 122, ROW = 72, SNAP = 24, STRIP = 10, HORIZONTAL_STRIP = 4;
// Native DIP bounds can round outward by one pixel at fractional scaling.
const inside = (b, a) => b.x >= a.x - 1 && b.y >= a.y - 1 && b.x + b.width <= a.x + a.width + 1 && b.y + b.height <= a.y + a.height + 1;
const sameBounds = (a, b) => !!a && !!b && ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 1);
function nearestEdge(b, area) {
  return [['left', Math.abs(b.x - area.x)], ['right', Math.abs(b.x + b.width - area.x - area.width)], ['top', Math.abs(b.y - area.y)], ['bottom', Math.abs(b.y + b.height - area.y - area.height)]].sort((a, b) => a[1] - b[1])[0][0];
}
function fitBounds(saved, displays, primary, height) {
  const valid = saved && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(saved[k])) && saved.width > 0 && saved.height > 0;
  const display = valid && displays.find(d => inside(saved, d.workArea));
  const area = (display || primary).workArea;
  const width = Math.min(WIDTH, area.width), h = Math.min(height, area.height);
  return {x: display ? Math.max(area.x, Math.min(saved.x, area.x + area.width - width)) : area.x + Math.max(0, area.width - width - 16),
    y: display ? Math.max(area.y, Math.min(saved.y, area.y + area.height - h)) : area.y + Math.min(16, Math.max(0, area.height - h)), width, height: h};
}
function snapBounds(bounds, area) {
  const b = {...bounds, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))};
  const distances = [['left', Math.abs(b.x - area.x)], ['right', Math.abs(b.x + b.width - area.x - area.width)], ['top', Math.abs(b.y - area.y)], ['bottom', Math.abs(b.y + b.height - area.y - area.height)]];
  const [edge, distance] = distances.sort((a, b) => a[1] - b[1])[0];
  if (distance > SNAP) return {bounds: b, edge: null};
  if (edge === 'left') b.x = area.x;
  if (edge === 'right') b.x = area.x + area.width - b.width;
  if (edge === 'top') b.y = area.y;
  if (edge === 'bottom') b.y = area.y + area.height - b.height;
  return {bounds: b, edge};
}
function popoverLayout(bounds, kind, area, anchor) {
  if (!kind) return {canvas: {...bounds}, card: {x:0,y:0,width:bounds.width,height:bounds.height}, popup: null};
  const width = Math.min(kind === 'rows' ? 140 : 320, area.width), height = Math.min(kind === 'rows' ? 138 : 310, area.height);
  const source = anchor || (kind === 'rows' ? {x:bounds.width-80,y:bounds.height,width:70} : {x:40,y:78,width:180});
  const x = Math.max(area.x, Math.min(bounds.x + source.x + source.width - width, area.x + area.width - width));
  const below = bounds.y + source.y + 4;
  const y = Math.max(area.y, Math.min(below + height <= area.y + area.height ? below : below - height - (kind === 'rows' ? 30 : 40), area.y + area.height - height));
  const left = Math.min(bounds.x,x), top = Math.min(bounds.y,y);
  return {canvas:{x:left,y:top,width:Math.max(bounds.x+bounds.width,x+width)-left,height:Math.max(bounds.y+bounds.height,y+height)-top},
    card:{x:bounds.x-left,y:bounds.y-top,width:bounds.width,height:bounds.height},popup:{x:x-left,y:y-top,width,height}};
}

// Reserve both popovers before painting. Toggling either one never resizes the
// native transparent window, avoiding an OS/Chromium resize race.
function stageLayout(bounds, kind, area, anchor) {
  const rects = [bounds];
  for (const y of [bounds.height - 34, bounds.height]) {
    for (const x of [bounds.width - 90, bounds.width - 70]) rects.push(popoverLayout(bounds, 'rows', area, {x,y,width:70}).canvas);
  }
  for (const y of [70,86]) {
    for (const x of [28,60]) rects.push(popoverLayout(bounds, 'calendar', area, {x,y,width:120}).canvas);
  }
  const x = Math.min(...rects.map(r=>r.x)), y = Math.min(...rects.map(r=>r.y));
  const canvas = {x,y,width:Math.max(...rects.map(r=>r.x+r.width))-x,height:Math.max(...rects.map(r=>r.y+r.height))-y};
  const active = popoverLayout(bounds, kind, area, anchor);
  const popup = active.popup && {x:Math.max(0,Math.min(active.canvas.x+active.popup.x-x,canvas.width-active.popup.width)),
    y:Math.max(0,Math.min(active.canvas.y+active.popup.y-y,canvas.height-active.popup.height)),width:active.popup.width,height:active.popup.height};
  return {canvas,card:{x:bounds.x-x,y:bounds.y-y,width:bounds.width,height:bounds.height},popup};
}

class DesktopWidget {
  constructor({BrowserWindow, screen, storage, file, snapshot, onChange, onOpen, onHide, model, taskCourseEnabled}) {
    Object.assign(this, {BrowserWindow, screen, storage, file, snapshot, onChange, onOpen, onHide, model, taskCourseEnabled});
    let saved;try {saved = storage.readJSON(file, {}) || {};} catch {saved = {};}
    this.settings = {enabled: saved.enabled !== false, rows: ROWS.includes(saved.rows) ? saved.rows : 5, pinned: saved.pinned === true, bounds: saved.bounds};
    this.date = model.dayKey();this.followToday = true;this.lastActive = Date.now();this.collapsed = false;this.edge = null;
    this.reflow = () => {this.expand();this.layout(true);this.push();};
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, this.reflow);
  }
  collapseDirection() {return this.edge || (this.settings.bounds ? nearestEdge(this.settings.bounds, this.screen.getDisplayMatching(this.settings.bounds).workArea) : 'right');}
  state() {return {...this.settings, date: this.date, followToday: this.followToday, mainClosed: !!this.mainClosed, collapsed: this.collapsed, edge: this.edge, collapseDirection: this.collapseDirection(), motion: this.motion || null, expandedBounds: this.displayBounds, cardFrame:this.cardFrame, popover:this.popover || null, popoverBounds:this.popoverBounds};}
  save() {const serialized = JSON.stringify(this.settings);if (serialized !== this.savedSettings) {this.storage.atomicWrite(this.file, this.settings);this.savedSettings = serialized;}}
  owns(event) {return this.window && !this.window.isDestroyed() && event.sender === this.window.webContents && event.senderFrame === this.window.webContents.mainFrame;}
  start() {if (this.settings.enabled) this.show();}
  show() {
    if (this.window && !this.window.isDestroyed()) {this.expand();this.layout();this.push();void this.reveal();this.lastActive = Date.now();return;}
    const win = new this.BrowserWindow({width: WIDTH, height: BASE + ROW * 5, frame: false, transparent: true, backgroundColor: '#00000000',
      title: '归序 · 桌面待办', icon: APP_ICON, show: false, opacity: 0, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, type: 'toolbar', hasShadow: false,
      webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false}});
    this.window = win;win.setMenu(null);win.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(false, {visibleOnFullScreen: false});
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('close', event => {if (!this.disposed) {event.preventDefault();this.configure({enabled: false});}});
    win.on('move', () => this.recordMove());
    win.webContents.on('did-finish-load', () => {this.rendererLoaded=true;this.publish(this.snapshot());void this.reveal();});
    this.layout(true);
    void win.loadFile(path.join(__dirname, '../dist/index.html'), {query: {window: 'widget'}});
    this.timer = setInterval(() => this.tick(), 200);this.timer.unref();
    this.pointerTimer = setInterval(() => this.updatePointer(), 16);this.pointerTimer.unref();
  }
  async reveal() {
    const win=this.window;
    if (!win || win.isDestroyed() || !this.rendererLoaded || !this.settings.enabled || this.visibilityTarget===true) return;
    const sequence=this.revealSequence=(this.revealSequence||0)+1;
    clearInterval(this.visibilityTimer);this.visibilityTimer=null;
    // Keep the native surface transparent until React has data, fonts and final geometry.
    if (!win.isVisible()) win.setOpacity(0);
    try {
      const reduced=await win.webContents.executeJavaScript(`new Promise(resolve=>{
        const ready=()=>{if(!document.querySelector('.desktop-widget[data-ready="true"]')){requestAnimationFrame(ready);return;}
          document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(matchMedia('(prefers-reduced-motion: reduce)').matches))));};ready();
      })`);
      if (sequence!==this.revealSequence || win.isDestroyed() || !this.settings.enabled) return;
      this.reducedMotion=reduced;
      if (nativeFullscreen?.isForegroundFullscreen()) {this.fullscreenSuspended=true;return;}
      this.fadeVisibility(true);
    } catch (error) {if (!win.isDestroyed()&&!this.disposed) console.warn('小组件绘制准备失败',error);}
  }
  fadeVisibility(visible,onFinish) {
    clearInterval(this.visibilityTimer);this.visibilityTimer=null;this.visibilityTarget=visible;
    const win=this.window;
    if (!win || win.isDestroyed()) {onFinish?.();return;}
    const target=visible?1:0,from=win.getOpacity(),started=Date.now(),duration=this.reducedMotion?0:200;
    if (visible&&!win.isVisible()) win.showInactive();
    const finish=()=>{clearInterval(this.visibilityTimer);this.visibilityTimer=null;win.setOpacity(target);if(!visible)win.hide();onFinish?.();};
    if (!duration || from===target || !visible&&!win.isVisible()) {finish();return;}
    this.visibilityTimer=setInterval(()=>{
      if (win.isDestroyed()) {clearInterval(this.visibilityTimer);this.visibilityTimer=null;return;}
      // Play the same cubic ease-out backwards when hiding.
      const progress=Math.min(1,(Date.now()-started)/duration),eased=visible?1-(1-progress)**3:progress**3;
      win.setOpacity(from+(target-from)*eased);
      if(progress===1)finish();
    },16);this.visibilityTimer.unref();
  }
  visibleBounds() {
    const native = this.window.getBounds(), frame = this.normalFrame || {x:0,y:0};
    return {...this.settings.bounds,x:native.x+frame.x,y:native.y+frame.y};
  }
  updateFrame() {
    if (!this.stageBounds || !this.displayBounds) return;
    const b = this.collapsed ? this.stripBounds() : this.displayBounds;
    this.cardFrame = {x:b.x-this.stageBounds.x,y:b.y-this.stageBounds.y,width:b.width,height:b.height};
  }
  updatePointer() {
    const win = this.window;
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const p = this.screen.getCursorScreenPoint(), native = win.getBounds();
    const contains = r => r && p.x>=native.x+r.x && p.x<=native.x+r.x+r.width && p.y>=native.y+r.y && p.y<=native.y+r.y+r.height;
    const ignore = !this.moveTimer && !this.motion && !contains(this.cardFrame) && !contains(this.popoverBounds);
    if (ignore !== this.ignoringMouse) {win.setIgnoreMouseEvents(ignore,{forward:true});this.ignoringMouse=ignore;}
  }
  recordMove() {
    const win = this.window;
    if (this.settingBounds || this.animationTimer || this.popover || this.collapsed || sameBounds(win.getBounds(), this.expectedBounds)) return;
    this.lastActive = Date.now();clearTimeout(this.moveTimer);
    // Update both normal and animation geometry immediately, before any data push.
    this.settings.bounds = this.visibleBounds();this.displayBounds = {...this.settings.bounds};this.edge = null;this.push();
    this.moveTimer = setTimeout(() => {this.moveTimer = null;if (!win.isDestroyed() && !this.collapsed) this.finishMove();}, 180);
  }
  finishMove() {
    clearTimeout(this.moveTimer);this.moveTimer = null;
    const bounds = this.visibleBounds(), area = this.screen.getDisplayMatching(bounds).workArea;
    // Moving a native window can round its size outward repeatedly; retain layout's intended size.
    bounds.width = Math.min(WIDTH, area.width);
    bounds.height = Math.min(BASE + ROW * Math.max(1, Math.min(this.settings.rows, this.count())), area.height);
    const snapped = snapBounds(bounds, area);this.edge = snapped.edge;
    this.settings.bounds = {...snapped.bounds};this.layout();this.save();this.push();
  }
  setBounds(bounds) {
    this.expectedBounds = bounds;
    if (this.window && !this.window.isDestroyed()) {
      this.settingBounds = true;
      try {
        this.window.setBounds(bounds);
      } finally {this.settingBounds = false;}
      // Windows rounds device-independent bounds at 125% / 150% scaling.
      this.expectedBounds = this.window.getBounds();
    }
    return this.expectedBounds;
  }
  animateCard() {
    clearTimeout(this.animationTimer);
    this.motion = this.collapsed ? 'collapsing' : 'expanding';this.updateFrame();this.push();
    this.animationTimer = setTimeout(() => {this.animationTimer=null;this.motion=null;this.updatePointer();this.push();},240);
  }
  count() {
    const state = this.lastSnapshot || this.snapshot();
    return state.tasks.filter(t => !t.deleted && this.taskCourseEnabled(state.coursePreferences, t) && !this.model.isTaskDone(t) && this.model.taskDueAt(t) && this.model.dayKey(this.model.taskDueAt(t)) === this.date).length;
  }
  layout(restore = false) {
    if (!this.window || this.window.isDestroyed() || this.moveTimer) return;
    const height = BASE + ROW * Math.max(1, Math.min(this.settings.rows, this.count()));
    let bounds = fitBounds(this.settings.bounds, this.screen.getAllDisplays(), this.screen.getPrimaryDisplay(), height);
    const area = this.screen.getDisplayMatching(bounds).workArea;
    if (!restore && this.edge === 'right') bounds.x = area.x + area.width - bounds.width;
    if (!restore && this.edge === 'bottom') bounds.y = area.y + area.height - bounds.height;
    const snapped = snapBounds(bounds, area);this.edge = snapped.edge;this.settings.bounds = snapped.bounds;
    this.displayBounds = {...snapped.bounds};
    const geometry = stageLayout(this.displayBounds, this.popover, area, this.popoverAnchor);
    this.normalFrame=geometry.card;this.stageBounds=geometry.canvas;this.popoverBounds=geometry.popup;this.updateFrame();
    if (!sameBounds(this.window.getBounds(),geometry.canvas)) this.setBounds(geometry.canvas);
    this.updatePointer();
    this.lastCount = this.count();
    this.save();
  }
  stripBounds() {
    const b = {...this.settings.bounds};
    if (this.edge === 'left' || this.edge === 'right') {if (this.edge === 'right') b.x += b.width - STRIP;b.width = STRIP;}
    else {if (this.edge === 'bottom') b.y += b.height - HORIZONTAL_STRIP;b.height = HORIZONTAL_STRIP;}
    return b;
  }
  tick() {
    if (!this.window || this.window.isDestroyed() || !this.settings.enabled || this.suspendForFullscreen() || !this.window.isVisible()) return;
    if (this.followToday && this.date !== this.model.dayKey()) {this.date = this.model.dayKey();this.layout();this.push();}
    // Only cursor geometry is sampled here; task data always arrives through publish().
    const p = this.screen.getCursorScreenPoint(), b = this.collapsed ? this.stripBounds() : this.visibleBounds(), margin = this.collapsed ? 24 : 0;
    const near = p.x >= b.x - margin && p.x <= b.x + b.width + margin && p.y >= b.y - margin && p.y <= b.y + b.height + margin;
    if (this.waitForPointerLeave && !near) this.waitForPointerLeave = false;
    if (near && !this.waitForPointerLeave) {this.lastActive = Date.now();this.expand();}
    else if (!this.settings.pinned && !this.popover && this.edge && !this.collapsed && Date.now() - this.lastActive >= 5000) {
      this.collapse();
    }
    // Phase changes can alter the height; no task snapshots are fetched or pushed by this timer.
    const count = this.count();if (count !== this.lastCount) {this.lastCount = count;this.layout();}
  }
  suspendForFullscreen() {
    const fullscreen = nativeFullscreen?.isForegroundFullscreen() || false;
    if (fullscreen) {this.fullscreenSuspended = true;this.revealSequence=(this.revealSequence||0)+1;clearInterval(this.visibilityTimer);this.visibilityTimer=null;this.visibilityTarget=false;this.window.hide();this.window.setOpacity(0);return true;}
    if (this.fullscreenSuspended) {this.fullscreenSuspended = false;this.lastActive = Date.now();if (this.settings.enabled) void this.reveal();}
    return false;
  }
  collapse(manual = false) {
    if (!this.window || this.window.isDestroyed() || this.collapsed) return;
    if (this.moveTimer) this.finishMove();
    this.popover = null;this.layout();
    const direction = this.collapseDirection(), bounds = {...this.settings.bounds}, area = this.screen.getDisplayMatching(bounds).workArea;
    if (direction === 'left') bounds.x = area.x;
    if (direction === 'right') bounds.x = area.x + area.width - bounds.width;
    if (direction === 'top') bounds.y = area.y;
    if (direction === 'bottom') bounds.y = area.y + area.height - bounds.height;
    this.edge = direction;this.settings.bounds = bounds;this.displayBounds = {...bounds};this.save();
    this.layout();this.waitForPointerLeave = manual;this.collapsed = true;this.animateCard();
  }
  expand() {if (!this.collapsed) return;this.waitForPointerLeave = false;this.collapsed = false;this.animateCard();this.lastActive = Date.now();}
  setPopover(kind, anchor) {
    if (![null, 'rows', 'calendar'].includes(kind)) throw new Error('菜单无效');
    if (anchor && (!['x','y','width'].every(key=>Number.isFinite(anchor[key])) || anchor.width < 0 || anchor.width > WIDTH || Math.abs(anchor.x)>WIDTH || anchor.y<0 || anchor.y>2000)) throw new Error('菜单位置无效');
    if (this.moveTimer) this.finishMove();
    this.popoverAnchor = anchor;
    this.popover = kind;this.lastActive = Date.now();this.layout();this.push();
  }
  setRows(rows) {if (!ROWS.includes(rows)) throw new Error('显示条数无效');this.popover = null;this.configure({rows});}
  configure(input) {
    if (!input || typeof input !== 'object') throw new Error('小组件设置无效');
    if ('enabled' in input && typeof input.enabled !== 'boolean' || 'pinned' in input && typeof input.pinned !== 'boolean' || 'rows' in input && !ROWS.includes(input.rows)) throw new Error('小组件设置无效');
    for (const key of ['enabled', 'pinned', 'rows']) if (key in input) this.settings[key] = input[key];
    this.lastActive = Date.now();
    if (this.settings.enabled) {this.show();this.layout();} else {
      this.revealSequence=(this.revealSequence||0)+1;
      this.fadeVisibility(false,()=>{if(!this.settings.enabled){this.popover=null;this.expand();this.layout();this.push();this.onHide();}});
    }
    this.save();this.push();this.onChange();
  }
  selectDate(date) {
    if (date !== 'today' && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || this.model.dayKey(`${date}T12:00:00`) !== date)) throw new Error('日期无效');
    this.popover = null;this.followToday = date === 'today';this.date = this.followToday ? this.model.dayKey() : date;this.lastActive = Date.now();this.layout();this.push();
  }
  publish(state, mainClosed = this.mainClosed) {
    this.mainClosed = mainClosed;
    if (!mainClosed || !this.lastSnapshot) this.lastSnapshot = state;
    this.layout();this.push();
  }
  push() {if (this.window && !this.window.isDestroyed() && this.lastSnapshot) this.window.webContents.send('data:update', {...this.lastSnapshot, widget: this.state()});}
  load() {return {...(this.lastSnapshot || this.snapshot()), widget: this.state()};}
  dispose() {
    this.disposed = true;this.revealSequence=(this.revealSequence||0)+1;clearInterval(this.visibilityTimer);clearTimeout(this.moveTimer);clearInterval(this.timer);clearTimeout(this.animationTimer);clearInterval(this.pointerTimer);
    if (this.window && !this.window.isDestroyed() && !this.collapsed && !this.motion && !this.popover) {
      const bounds = this.visibleBounds();
      this.settings.bounds = snapBounds(bounds, this.screen.getDisplayMatching(bounds).workArea).bounds;this.save();
    }
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) this.screen.removeListener(event, this.reflow);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
  }
}
module.exports = {DesktopWidget, fitBounds, snapBounds, nearestEdge, popoverLayout, stageLayout};
