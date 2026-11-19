const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function platformPage(name, retryURL, errorCode = '') {
  const failed = !!errorCode;
  const code = /^ERR_[A-Z_]+$/.test(errorCode) ? errorCode : 'ERR_CONNECTION_FAILED';
  const message = /CERT|SSL/.test(code) ? '安全连接未能建立，请检查系统时间和网络证书后重试。'
    : /PROXY|TUNNEL/.test(code) ? '代理连接失败，请检查系统代理设置后重试。'
    : /NAME_NOT_RESOLVED/.test(code) ? '未能找到网站地址，请检查网络或校园网连接后重试。'
    : '网站暂时未能打开，请检查网络、校园网或系统代理后重试。';
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><title>${escape(name)} · ${failed ? '页面未能打开' : '正在打开'}</title><style>body{margin:0;background:#f7faf8;color:#243d33;font:16px 'Segoe UI','Microsoft YaHei',sans-serif;display:grid;min-height:100vh;place-items:center}.card{padding:36px;max-width:540px;background:#fff;border:1px solid #dce7e0;border-radius:16px;box-shadow:0 8px 30px #243d3308}h1{font-size:24px}p{line-height:1.8;color:#53685e}a{display:inline-block;color:white;background:#337757;border-radius:8px;padding:10px 18px;text-decoration:none}small{display:block;margin:18px 0;color:#65776d}</style><div class="card"><h1>${escape(name)} · ${failed ? '页面未能打开' : '正在打开官方登录页…'}</h1><p>${failed ? message : '请稍候。页面打开后，请在官方网站完成身份认证。'}</p>${failed ? `<small>${escape(code)}</small><a href="${escape(retryURL)}">重新打开官方页面</a>` : ''}<p>已有待办保留。关闭此窗口可返回归序。</p></div></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}
module.exports = {platformPage};
