export function launchDesktop({spawn, executable, cwd, args = [], env = process.env, output = console, exit = code => {process.exitCode = code;}, setTimer = setTimeout, clearTimer = clearTimeout}) {
  const childEnv = {...env};delete childEnv.ELECTRON_RUN_AS_NODE;
  const compatibility = args.includes('--review-compat');
  if (compatibility && !args.includes('--review')) throw new Error('兼容启动仅用于源码审查');
  const electronArgs = args.filter(arg => arg !== '--review-compat');
  if (compatibility) {
    output.error('源码审查兼容模式：本次关闭 Electron 进程隔离保护，请勿用于日常运行。');
    electronArgs.unshift('--no-sandbox');
  }
  output.log('正在启动归序…');
  const child = spawn(executable, [cwd, ...electronArgs], {cwd, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: childEnv, windowsHide: false});
  let ready = false, handedOff = false, failed = false;
  const timer = setTimer(() => {if (!ready && !handedOff) output.error('归序仍未打开主窗口，请查看是否有启动错误弹窗。');}, 15000);
  child.on('message', message => {
    if (message?.type === 'desktop:handoff') {
      handedOff = true;clearTimer(timer);output.log('已向正在运行的归序请求打开窗口。');return;
    }
    if (message?.type !== 'desktop:ready') return;
    ready = true;clearTimer(timer);output.log('归序窗口已打开。');
  });
  child.on('error', error => {
    failed = true;clearTimer(timer);output.error(`归序未能启动：${error.message}`);exit(1);
  });
  child.on('exit', (code, signal) => {
    clearTimer(timer);
    if (failed) return;
    if (code === 0 && !ready && !handedOff) {
      output.error('归序在打开主窗口前退出，未确认有正在运行的实例接管。请检查上方的启动错误。');exit(1);return;
    }
    if (code !== 0) {
      const reason = signal ? `信号 ${signal}` : `退出码 0x${(code >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
      output.error(`归序${ready ? '' : '在打开主窗口前'}异常退出（${reason}）。`);
      if ((code >>> 0) === 0x80000003) {
        output.error('Electron 运行时在启动阶段崩溃，请检查 Electron 安装及 Windows 运行环境。');
        if (args.includes('--review') && !compatibility) output.error('临时源码审查可运行 npm run review -- --review-compat；该模式会关闭 Electron 进程隔离保护。');
      }
    }
    exit(code === 0 ? 0 : 1);
  });
  return child;
}
