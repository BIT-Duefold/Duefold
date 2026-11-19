// Electron fetch rejects redirect:'manual' with "Redirect was cancelled".
// ClientRequest exposes redirects explicitly, without following their destination.
function requestSession(net, ses, url, {headers = {}, signal, timeoutMs = 12000, maxBytes = 512 * 1024, method = 'GET', form = null} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {reject(new Error('request_cancelled'));return;}
    let request, timer, settled = false;
    const finish = (error, result) => {
      if (settled) return;settled = true;clearTimeout(timer);signal?.removeEventListener('abort', cancel);
      if (error) reject(error);else resolve(result);
    };
    const stop = (error, result) => {finish(error, result);request?.abort();};
    const cancel = () => stop(new Error('request_cancelled'));
    const header = (all, key) => {
      const value = Object.entries(all).find(([name]) => name.toLowerCase() === key)?.[1];
      return Array.isArray(value) ? value[0] : value;
    };
    try {
      request = net.request({url, session: ses, method, redirect: 'manual', useSessionCookies: true});
      for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
      request.setHeader('Cache-Control', 'no-cache');
      if (form !== null) request.setHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
      request.on('redirect', (status, _method, destination, responseHeaders) => {
        stop(null, {status, location: header(responseHeaders, 'location') || destination, body: null, text: null});
      });
      request.on('response', response => {
        const contentType = header(response.headers, 'content-type') || '';
        const json = /json/i.test(contentType);
        const textual = json || /html|text/i.test(contentType);
        let size = 0;
        const chunks = [];
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) {stop(new Error('response_too_large'));return;}
          if (textual) chunks.push(Buffer.from(chunk));
        });
        response.on('end', () => {
          if (!textual) {finish(null, {status: response.statusCode, location: header(response.headers, 'location'), body: null, text: null});return;}
          const raw = Buffer.concat(chunks).toString('utf8');
          let body = null;
          if (json) {try {body = JSON.parse(raw);} catch {}}
          finish(null, {status: response.statusCode, location: header(response.headers, 'location'), body, text: json && body !== null ? null : raw});
        });
        response.on('error', error => finish(error));
        response.on('aborted', () => finish(new Error('response_aborted')));
      });
      request.on('error', error => finish(error));
      request.on('abort', () => finish(new Error('request_cancelled')));
      signal?.addEventListener('abort', cancel, {once: true});
      timer = setTimeout(() => stop(new Error('request_timeout')), timeoutMs);timer.unref?.();
      if (signal?.aborted) {cancel();return;}
      request.end(form === null ? undefined : Buffer.from(String(form), 'utf8'));
    } catch (error) {stop(error);}
  });
}
module.exports = {requestSession};
