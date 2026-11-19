// Cookie persistence belongs to the session, independent of any login window.
function watchSessionCookies(ses,{trusted,read,write}) {
  let pending=Promise.resolve(),closed=false;
  const capture=()=>{
    pending=pending.catch(()=>{}).then(async()=>{
      if(closed)return;
      const cookies=(await ses.cookies.get({})).filter(c=>trusted(`https://${c.domain.replace(/^\./,'')}/`));
      if(closed || !cookies.length&&!read())return;
      await write({...read(),cookies});
    });
    return pending;
  };
  const changed=(_,cookie)=>{if(trusted(`https://${cookie.domain.replace(/^\./,'')}/`))void capture().catch(()=>{});};
  ses.cookies.on('changed',changed);
  return {capture,flush:()=>pending,dispose:()=>{closed=true;ses.cookies.removeListener('changed',changed);}};
}
module.exports={watchSessionCookies};
