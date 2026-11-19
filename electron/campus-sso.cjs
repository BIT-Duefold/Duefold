const CAMPUS = new Set(['yanhe', 'lexue']);
function isCampusCookie(c) {
  const host = String(c.domain || '').replace(/^\./, '').toLowerCase();
  return ['sso.bit.edu.cn', 'login.bit.edu.cn'].includes(host) ||
    host === 'bit.edu.cn' && ['SOURCEID_TGC', 'CASTGC', 'TGC'].includes(c.name);
}
function cookieDetails(c) {
  const {hostOnly, session, ...details} = c;
  if (hostOnly) delete details.domain;
  return {...details, url: `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`};
}
const key = c => [c.domain,c.path || '/',c.name].join('|');
const live = c => !c.expirationDate || c.expirationDate * 1000 > Date.now();
class CampusSso {
  constructor(cookies, save) {
    this.cookies = new Map((cookies || []).filter(c => isCampusCookie(c) && live(c)).map(c => [key(c),c]));
    this.sessions = new Map();this.save = save;this.pending = Promise.resolve();
  }
  async attach(id, ses) {
    if (!CAMPUS.has(id)) return;
    for (const c of this.cookies.values()) if (live(c)) await ses.cookies.set(cookieDetails(c)).catch(() => {});
    const listener = (_, c, cause, removed) => {
      if (!isCampusCookie(c) || removed && cause === 'overwrite') return;
      this.pending = this.pending.then(async () => {
        if (this.sessions.get(id)?.ses !== ses) return;
        const old = this.cookies.get(key(c));
        if (removed) {if (!old || old.value !== c.value) return;this.cookies.delete(key(c));}
        else {if (old && JSON.stringify(old) === JSON.stringify(c)) return;this.cookies.set(key(c),c);}
        this.save([...this.cookies.values()].filter(live));
        for (const [other, target] of this.sessions) if (other !== id) {
          if (removed) await target.ses.cookies.remove(cookieDetails(c).url,c.name).catch(() => {});
          else {
            const existing = (await target.ses.cookies.get({name:c.name})).find(x => key(x) === key(c));
            if (!existing || existing.value !== c.value || existing.expirationDate !== c.expirationDate) await target.ses.cookies.set(cookieDetails(c)).catch(() => {});
          }
        }
      }).catch(() => {});
    };
    this.sessions.set(id,{ses,listener});ses.cookies.on('changed',listener);
  }
  detach(id) {
    if (!CAMPUS.has(id)) return;
    const target = this.sessions.get(id);if (target) target.ses.cookies.removeListener('changed',target.listener);
    this.sessions.delete(id);
    // Explicitly disconnecting the last campus platform also forgets reusable SSO.
    if (!this.sessions.size) {this.cookies.clear();this.save([]);}
  }
  flush() {return this.pending;}
}
module.exports = {CampusSso,isCampusCookie,cookieDetails};
