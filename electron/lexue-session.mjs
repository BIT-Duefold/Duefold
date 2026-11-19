// Lexue (Moodle) keeps its own session cookie next to the shared campus SSO. This
// module discovers the exact CAS service Lexue uses and follows the ticket back,
// so the saved campus password can refresh the Lexue session without a window.
export const LEXUE_LOGIN = 'https://lexue.bit.edu.cn/login/index.php';

const lexueHost = host => host === 'lexue.bit.edu.cn' || host.endsWith('.lexue.bit.edu.cn');
const campusHost = host => host === 'bit.edu.cn' || host.endsWith('.bit.edu.cn');

// Lexue answers an unauthenticated login page with a CAS redirect carrying its own
// service string. Anything else (a local login form, another host) is not usable.
export async function discoverLexueService(request) {
  const reply = await request(LEXUE_LOGIN, {timeoutMs: 15000});
  if (!(reply.status >= 300 && reply.status < 400) || !reply.location) return null;
  let login;try {login = new URL(reply.location, LEXUE_LOGIN);} catch {return null;}
  if (!['login.bit.edu.cn', 'sso.bit.edu.cn'].includes(login.hostname)) return null;
  const service = login.searchParams.get('service');
  let parsed;try {parsed = new URL(service);} catch {return null;}
  if (parsed.origin !== 'https://lexue.bit.edu.cn') return null;
  return {service, loginUrl: login.toString()};
}

// Follow the ticket redirect chain; only Lexue and campus hosts are followed.
export async function followLexueTicket(request, ticketUrl) {
  let next = ticketUrl;
  for (let hop = 0; hop < 6; hop++) {
    const reply = await request(next, {timeoutMs: 15000});
    if (!(reply.status >= 300 && reply.status < 400) || !reply.location) return true;
    let target;try {target = new URL(reply.location, next);} catch {return true;}
    if (!lexueHost(target.hostname) && !campusHost(target.hostname)) return true;
    next = target.toString();
  }
  return true;
}
