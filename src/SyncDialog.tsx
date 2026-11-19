import {useEffect, useRef, useState} from 'react';
import {bridge} from './bridge';
import {Cloud, ShieldCheck} from './icons';
import type {CloudDevice, PendingDeviceRequest, Snapshot, SyncProvider} from './types';

const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '尚未在线';

export function SyncDialog({state, onClose, notify}: {state: Snapshot; onClose: () => void; notify: (text: string) => void}) {
  const settings = state.settings;
  const [tab, setTab] = useState<SyncProvider>('ws');
  const [url, setUrl] = useState(settings.ws.url);
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(settings.provider === 'ws' && settings.enabled);
  const [cloud, setCloud] = useState({...settings.supabase});
  const [mode, setMode] = useState<'join' | 'request' | 'recover'>(settings.supabasePendingDeviceRequest ? 'request' : 'join');
  const [username, setUsername] = useState(settings.supabasePendingDeviceRequest?.username ?? '');
  const [code, setCode] = useState('');
  const [deviceName, setDeviceName] = useState(settings.defaultDeviceName ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [now, setNow] = useState(Date.now());
  const wsActive = settings.provider === 'ws' && settings.enabled;
  const active = settings.provider === 'supabase' && settings.enabled;
  // The status line follows the visible tab, so the self-hosted page never surfaces a cloud waiting state.
  const cloudWaiting = state.syncStatus === '等待加入';
  const cloudTitle = active ? (cloudWaiting ? '尚未加入' : state.syncStatus) : '同步已关闭';
  const cloudDetail = active ? (cloudWaiting ? '加入或发起申请后开始同步' : '正在使用 Supabase Cloud') : '加入或启用后开始同步';
  const statusTitle = tab === 'ws' ? (wsActive ? state.syncStatus : '自建服务未启用') : cloudTitle;
  const statusDetail = tab === 'ws' ? (wsActive ? '正在使用自建服务' : '填写地址和密钥后启用') : cloudDetail;
  const joined = !!settings.supabaseUsername;
  const request = settings.supabasePendingDeviceRequest;
  const remaining = request ? Math.max(0, Math.ceil((Date.parse(request.expiresAt) - now) / 1000)) : 0;
  const retrySeconds = Math.max(0, Math.ceil(((settings.supabaseRetryAt ?? 0) - now) / 1000));
  useEffect(() => {if (!request && !settings.supabaseRetryAt) return;const timer = setInterval(() => setNow(Date.now()), 1000);return () => clearInterval(timer);}, [request?.expiresAt, settings.supabaseRetryAt]);

  async function perform(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;setBusy(true);setError('');
    try {await work();} catch (error) {setError((error as Error).message);} finally {busyRef.current = false;setBusy(false);}
  }
  async function configureCloud(enable: boolean) {
    await bridge.configureSync({provider: 'supabase', enabled: enable, ws: settings.ws, supabase: cloud});
  }
  async function ensureCloud() {
    if (!active || cloud.url !== settings.supabase.url || cloud.publishableKey !== settings.supabase.publishableKey) await configureCloud(true);
  }

  return <>
    <div className="sync-status-panel" role="status"><Cloud size={22}/><div><strong>{statusTitle}</strong><p>{statusDetail} · 当前设备 {settings.supabaseDeviceName || settings.defaultDeviceName || state.device.slice(0, 8)}</p></div></div>
    {tab === 'supabase' && active && retrySeconds > 0 && <p className="muted-text">将在 {retrySeconds} 秒后重试连接。</p>}
    {tab === 'ws' ? <div aria-label="自建服务">
      <form onSubmit={event => {event.preventDefault();void perform(async () => {await bridge.configureSync({url, token, enabled});notify(enabled ? '设置已保存，正在连接自建服务' : '已关闭同步，待办继续保存在本机');onClose();});}}>
        <label className="field">服务地址<input type="text" placeholder="wss://sync.example.com" value={url} disabled={busy} onChange={event => setUrl(event.target.value)}/></label>
        <label className="field">同步密钥<input type="password" autoComplete="off" placeholder={settings.hasToken ? '已安全保存，留空则继续使用' : '至少 32 个字符，与服务端一致'} value={token} disabled={busy} onChange={event => setToken(event.target.value)}/></label>
        <label className="checkbox-line"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)}/>启用实时同步</label>
        <p className="muted-text">公网使用 wss://，本机调试可用 ws://127.0.0.1:8787。</p>
        <SyncPrivacy/>{error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-footer"><button type="button" className="text-button sync-provider-link" disabled={busy} onClick={() => {setTab('supabase');setError('');}}>supabase</button><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}>保存设置</button></div>
      </form>
    </div> : <div aria-label="Supabase Cloud">
      <SyncPrivacy/>
      {active && joined ? <>
        <div className="cloud-account"><strong>{settings.supabaseUsername}</strong><span>{settings.supabaseDeviceCount ?? 0} / 4 台活跃设备</span></div>
        <DeviceManager notify={notify} disabled={busy}/>
      </> : <>
        {!active && <p className="muted-text">加入或发起申请时会启用 Supabase Cloud，并合并本机已有待办。</p>}
        {active && settings.hasSupabaseSession && <p className="muted-text">已安全保存本机云端身份，可继续完成加入。</p>}
        {request && <div className="cloud-request" aria-label="新设备确认码">
          <strong>{remaining ? '等待已登录设备批准' : '申请已过期，请重新发起'}</strong>
          <p>账号 {request.username} · {request.deviceName}</p>
          <output className="cloud-confirm-code" aria-label="6 位确认码">{request.code}</output>
          <p>请在已登录设备的“待批准请求”中手工输入此码。</p>
          <p>{remaining ? `剩余 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒；批准后将自动开始同步。` : '重新发起会获取新的有效申请。'}</p>
          <p className="muted-text">关闭此窗口仍会检查批准结果；关闭同步会暂停检查。已有有效申请会复用原确认码。</p>
          {remaining > 0 && <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {await ensureCloud();await bridge.requestSupabaseDevice({username: request.username, deviceName: request.deviceName});notify('已重新获取当前申请的确认码');})}>重新获取确认码</button>}
        </div>}
        <div className="cloud-join-modes" aria-label="加入方式">{([['join', '首次使用'], ['request', '添加新设备'], ['recover', '恢复账号']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} disabled={busy} onClick={() => {setMode(value);setCode('');setError('');}}>{label}</button>)}</div>
        {(!request || !remaining || mode !== 'request') && <form onSubmit={event => {event.preventDefault();void perform(async () => {
          await ensureCloud();
          if (mode === 'request') {await bridge.requestSupabaseDevice({username, deviceName});notify('申请已发出，请在已登录设备批准');}
          else {const result = await bridge.joinSupabase({username, code, deviceName});setCode('');notify(result.kind === 'recover' ? '账号已恢复，正在合并待办' : '已加入，正在合并待办');}
        });}}>
          <label className="field">用户名<input value={username} autoComplete="off" required minLength={3} maxLength={20} pattern="[a-z0-9_]{3,20}" placeholder="3–20 位小写字母、数字或下划线" disabled={busy} onChange={event => setUsername(event.target.value)}/></label>
          {mode !== 'request' && <label className="field">{mode === 'recover' ? '恢复码' : '邀请码'}<input value={code} type="password" autoComplete="off" required maxLength={64} placeholder={mode === 'recover' ? '向管理员获取 16 位恢复码' : '管理员提供的 16 位邀请码'} disabled={busy} onChange={event => setCode(event.target.value)}/></label>}
          <label className="field">设备名<input value={deviceName} autoComplete="off" required maxLength={80} disabled={busy} onChange={event => setDeviceName(event.target.value)}/></label>
          <p className="muted-text">{mode === 'recover' ? '全部设备丢失时，请联系管理员生成恢复码。恢复后仍保留云端待办，每个账号最多 4 台活跃设备。' : mode === 'request' ? '需要另一台已登录设备批准。每个账号最多 4 台活跃设备。' : '用户名需与管理员生成邀请码时填写的一致。'}</p>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? '正在处理…' : mode === 'request' ? request ? '重新发起申请' : '发起设备申请' : mode === 'recover' ? '恢复并同步' : '加入并同步'}</button>
        </form>}
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer cloud-footer">
        <button type="button" className="text-button sync-provider-link" disabled={busy} onClick={() => {setTab('ws');setError('');}}>自建服务</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {await configureCloud(true);notify('已启用 Supabase Cloud，正在连接');})}>{active ? '保存并重新连接' : '启用云端同步'}</button>
        {active && <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {await configureCloud(false);notify('已关闭同步，本机待办和云端身份已保留');})}>关闭同步</button>}
        <button type="button" className="primary-button" onClick={onClose}>完成</button>
      </div>
    </div>}
  </>;
}

function SyncPrivacy() {return <div className="subtle-note"><ShieldCheck size={16}/><p>只同步待办，不同步学校登录会话。每台设备同时使用一种同步服务，切换时保留本机待办。</p></div>;}

function DeviceManager({notify, disabled}: {notify: (text: string) => void; disabled: boolean}) {
  const [devices, setDevices] = useState<CloudDevice[]>([]);
  const [requests, setRequests] = useState<PendingDeviceRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<PendingDeviceRequest | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [revocation, setRevocation] = useState<CloudDevice | null>(null);
  const running = useRef(false), alive = useRef(true);
  async function reload() {
    const nextDevices = await bridge.listSupabaseDevices();
    const nextRequests = await bridge.pendingSupabaseRequests();
    if (alive.current) {setDevices(nextDevices);setRequests(nextRequests);setLoaded(true);}
  }
  async function perform(work?: () => Promise<void>) {
    if (running.current || disabled) return;
    running.current = true;setBusy(true);setError('');
    try {await work?.();await reload();} catch (error) {if (alive.current) setError((error as Error).message);} finally {running.current = false;if (alive.current) setBusy(false);}
  }
  useEffect(() => {
    alive.current = true;void perform();
    const timer = setInterval(() => {void perform();}, 12000);
    return () => {alive.current = false;clearInterval(timer);};
  }, []);
  const blocked = busy || disabled;
  return <section className="cloud-management" aria-label="设备管理">
    <div className="cloud-section-heading"><h3>设备列表</h3><button type="button" className="secondary-button" disabled={blocked} onClick={() => void perform()}>刷新设备</button></div>
    {!loaded && <p className="muted-text">{busy ? '正在读取设备…' : '暂未读取到设备，请刷新重试。'}</p>}
    <ul className="cloud-device-list">{devices.map(device => <li key={device.deviceId}><div><strong>{device.name}{device.isCurrent ? '（当前设备）' : ''}</strong><p>{device.status === 'active' ? '活跃' : '已撤销'} · 最后在线：{dateLabel(device.lastSeen)}</p></div>{device.status === 'active' && <button type="button" className="danger-button" disabled={blocked} aria-label={`撤销 ${device.name}`} onClick={() => {setRevocation(device);setApproval(null);setError('');}}>撤销</button>}</li>)}</ul>
    {revocation && <div className="cloud-action-confirm" role="group" aria-label="确认撤销设备"><p>确定撤销“{revocation.name}”吗？{revocation.isCurrent ? '当前设备将停止同步，恢复使用可能需要管理员协助或新设备。' : '该设备将失去同步权限。'}本机待办会保留。</p><div className="cloud-actions"><button className="secondary-button" disabled={blocked} onClick={() => setRevocation(null)}>取消撤销</button><button className="danger-button" disabled={blocked} onClick={() => void perform(async () => {await bridge.revokeSupabaseDevice({deviceId: revocation.deviceId});setRevocation(null);notify('设备已撤销');})}>确认撤销</button></div></div>}
    <h3>待批准请求</h3>
    <p className="muted-text">仅批准你认识的设备，确认码需从新设备屏幕读取。</p>
    {loaded && requests.length === 0 && <p className="muted-text">暂无待批准请求，列表会自动刷新。</p>}
    <ul className="cloud-device-list">{requests.map(request => <li key={request.requestId}><div><strong>{request.deviceName}</strong><p>申请时间：{dateLabel(request.createdAt)}<br/>有效至：{dateLabel(request.expiresAt)}</p></div><div className="cloud-actions"><button type="button" className="secondary-button" disabled={blocked} aria-label={`批准 ${request.deviceName}`} onClick={() => {setApproval(request);setConfirmation('');setRevocation(null);setError('');}}>批准</button><button type="button" className="danger-button" disabled={blocked} aria-label={`拒绝 ${request.deviceName}`} onClick={() => void perform(async () => {await bridge.denySupabaseDevice({requestId: request.requestId});if (approval?.requestId === request.requestId) setApproval(null);notify('已拒绝设备申请');})}>拒绝</button></div></li>)}</ul>
    {approval && <form className="cloud-action-confirm" aria-label="批准设备申请" onSubmit={event => {event.preventDefault();void perform(async () => {await bridge.approveSupabaseDevice({requestId: approval.requestId, code: confirmation});setApproval(null);setConfirmation('');notify('设备已批准');});}}><label className="field">输入“{approval.deviceName}”屏幕上的 6 位确认码<input autoFocus inputMode="numeric" autoComplete="off" value={confirmation} required pattern="[0-9]{6}" minLength={6} maxLength={6} disabled={blocked} onChange={event => setConfirmation(event.target.value.replace(/\D/g, ''))}/></label><div className="cloud-actions"><button type="button" className="secondary-button" disabled={blocked} onClick={() => setApproval(null)}>取消批准</button><button type="submit" className="primary-button" disabled={blocked || confirmation.length !== 6}>确认批准</button></div></form>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
