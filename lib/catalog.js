import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export async function sessionCatalog(ctx) {
  const get = n => ctx.get?.(n) ?? ctx[n], rows = new Map(), home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const add = (header,live=false) => {
    if (!header?.id) return;
    let title = String(header.title || ''), at = 0;
    try { const r=JSON.parse(fs.readFileSync(path.join(home,'storages','session_projcache','sessions',header.id+'.json'),'utf8'))?.record?.rows;
      title=String(r?.title?.val || title); at=Number(r?.sessionListMetadata?.val?.lastPromptAt || 0); } catch {}
    rows.set(header.id,{id:header.id,title:title || header.id,cwd:String(header.cwd || ''),live,at});
  };
  const persistence=get('sessionPersistence');
  if (persistence?.list) for (const snapshot of await persistence.list()) add(snapshot.header);
  for(const agent of ctx.agents.list()) add({...agent.session.header,id:agent.session.id},true);
  return [...rows.values()].sort((a,b)=>Number(b.live)-Number(a.live)||b.at-a.at||a.title.localeCompare(b.title));
}
