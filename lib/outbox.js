import {createHash} from 'node:crypto';
import {splitMessage,extractImages} from './media.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
export class Outbox {
  constructor(bridge){this.b=bridge;this.chains=new Map();}
  send(c,text,id,options={}){
    if(!/^[\w-]{1,80}$/.test(id??''))return Promise.reject(Error('requestId 必须是 1–80 位字母、数字、下划线或短横线'));
    if(typeof text!=='string'||text.length>16000)return Promise.reject(Error('文本最多 16000 字'));
    const context={turn:this.b.turns.get(c.key)};
    try{this.b.rhythm.focus(context.turn,options.focusMessageIds);}catch(e){return Promise.reject(e);}
    if(context.turn)context.focus={focusIds:[...(context.turn.focusIds||[])],focusUsers:[...(context.turn.focusUsers||[])]};
    const previous=this.chains.get(c.key)||Promise.resolve();
    const task=previous.catch(()=>{}).then(()=>this.perform(c,text,id,options,context));this.chains.set(c.key,task);
    task.finally(()=>{if(this.chains.get(c.key)===task)this.chains.delete(c.key);}).catch(()=>{});return task;
  }
  async perform(c,text,id,options,context){
    const b=this.b,cfg=b.config(),mode=cfg.dryRun?'preview':'live';
    const jobs=b.store.data.outbox??={};const key=`${c.key}:${mode}:${id}`;
    const digest=hash(JSON.stringify({text,options}));let job=jobs[key];
    if(job&&job.digest!==digest)throw Error('requestId 已用于不同操作，请使用新的 ID');
    if(job?.status==='superseded')return {status:'deferred',sent:false,instruction:'剩余消息已取消，结合新消息重新组织回复，不要重放旧内容。'};
    if(!job){
      const parsed=extractImages(text);const sources=[...parsed.images,...(options.images||[])];
      if(sources.length>(cfg.imageLimit??4))throw Error('发送图片超过张数上限');
      const parts=splitMessage(parsed.text,cfg.splitReplies!==false).map(text=>({kind:'text',text}));
      if(parts.length>30)throw Error('一次最多发送 30 段');
      if((sources.length||options.record)&&!b.media)throw Error('媒体服务不可用');
      for(const source of sources)parts.push({kind:'image',source});
      if(options.record)parts.push({kind:'record',source:options.record});
      if(!parts.length)throw Error('消息不能为空');
      // Resolve all files before sending any part, so a missing sticker cannot cause half a reply.
      for(const part of parts)if(part.kind!=='text'){
        const segment=await b.media.outbound(part.source,options.cwd||cfg.workspace,part.kind);
        part.file=b.media.save(Buffer.from(segment.data.file.slice(9),'base64'),part.kind==='record'?'audio':'image');
      }
      job=jobs[key]={digest,parts,at:Date.now(),status:'pending',next:0,results:[]};b.store.save();
    }
    const repeated=job.next===job.parts.length;
    // Replay receipts only; never send a second copy of an already confirmed part.
    for(let i=repeated?0:job.next;i<job.parts.length;i++){
      const part=job.parts[i];
      const message=part.kind==='text'?[{type:'text',data:{text:part.text}}]:[await b.media.outbound(part.file,'',part.kind)];
      if(options.replyTo&&i===0)message.unshift({type:'reply',data:{id:options.replyTo}});
      const child=job.parts.length===1?id:'part-'+hash(`${id}:${i}`).slice(0,48);
      const result=await b.action(c,child,c.type==='group'?'send_group_msg':'send_private_msg',{
        [c.type==='group'?'group_id':'user_id']:Number(c.id),message},context);
      if(['deferred','suppressed'].includes(result.status)){job.status='superseded';b.store.save();return {...result,partsSent:job.next,totalParts:job.parts.length};}
      if(!['confirmed','preview'].includes(result.status))return {...result,partsSent:job.next,instruction:'有一段发送结果未知，停止后续发送；核实平台记录后处理。'};
      job.results[i]=result;job.next=Math.max(job.next,i+1);b.store.save();
      if(b.config().cooperate){const entry=b.store.data.actions[`${c.key}:${mode}:${child}`];try{b.cooperation.receipt(c,entry);}catch{result.memorySynced=false;b.report('QQ 回执已保存，但记忆同步失败；复用 requestId 可补记');}}
      if(!repeated&&i<job.parts.length-1)await new Promise(resolve=>{const done=()=>{clearTimeout(timer);b.abort.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,cfg.replyIntervalMs??450);if(b.abort.signal.aborted)done();else b.abort.signal.addEventListener('abort',done,{once:true});});
    }
    job.status='completed';b.store.save();
    return job.parts.length===1?{...job.results[0],...(repeated?{repeated:true}:{})}:{status:cfg.dryRun?'preview':'confirmed',repeated,parts:job.results.length,results:job.results};
  }
  async close(){await Promise.allSettled(this.chains.values());}
}
