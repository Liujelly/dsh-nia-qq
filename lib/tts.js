import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const VOICE='voc_8yud7hz7c9q2';
const ENDPOINT=`https://api.breeze.blue/v1/text-to-speech/${VOICE}?output_format=mp3&delivery=sync`;
const hash=value=>createHash('sha256').update(value).digest('hex');
export class TTS {
 constructor(bridge,{fetchImpl=globalThis.fetch,now=()=>Date.now(),key=()=>{const file=bridge.config().ttsKeyFile;if(!file)return process.env.BREEZE_API_KEY;if(!path.isAbsolute(file))throw Error('invalid key file');const stat=fs.statSync(file);if(!stat.isFile()||stat.size>4096)throw Error('invalid key file');return fs.readFileSync(file,'utf8').trim();}}={}){Object.assign(this,{bridge,fetchImpl,now,key});this.running=new Map();this.recordCapabilities=new WeakMap();}
 // Match contact-generated audio by content, including outbox copies and renamed files.
 validateRecord(c,bytes,turn){
  const b=this.bridge,digest=hash(bytes),jobs=Object.values(b.store.data.ttsJobs||{}).filter(x=>x.contactAudioHash===digest);
  if(!jobs.length)return;
  const valid=jobs.some(job=>{const cap=this.recordCapabilities.get(job);return cap&&cap.chat===c.key&&cap.turn===turn&&b.turns.get(c.key)===turn&&job.status==='completed'&&cap.valid()&&this.now()-turn.at<=600000&&!turn.silent&&!turn.deferred&&!b.abort.signal.aborted&&!b.closed&&b.ready&&b.config().enabled&&c.active&&!c.paused&&c.account===b.account&&Array.isArray(b.store.data.inbox)&&!b.store.data.inbox.some(x=>x.chat===c.key&&['pending','failed','delivering','uncertain'].includes(x.status));});
  if(!valid)throw Error('联系意图语音已过期或已取消，不能发送');
 }
 synthesize(c,text,id){
  const b=this.bridge,cfg=b.config();if(!cfg.ttsEnabled)throw Error('语音合成未启用');
  const turn=b.turns.get(c.key),capability=turn?.contactVoice;
  const contactValid=()=>!!capability&&turn.contactVoice===capability&&capability.target===c.key&&capability.preview===!!b.config().dryRun&&b.store.data.intents?.[capability.id]===capability.intent&&capability.intent.id===capability.id&&capability.intent.target===c.key&&capability.intent.preview===capability.preview&&capability.intent.personaId===(b.config().personaId||'nia')&&['delivering','accepted'].includes(capability.intent.status)&&(capability.intent.origin!=='activity'||(!c.activityContactsPaused&&b.activityPolicy?.()));
  const inbound=!!turn?.qq&&/^-?\d+$/.test(String(turn.voiceRequestId??''));
  if(!turn?.qq||(!inbound&&!contactValid())||turn.silent||turn.deferred||this.now()-turn.at>600000)throw Error('当前不是有效的 QQ 新入站或可信联系意图轮次，或本轮已结束');
  const blockedInbox=()=>!Array.isArray(b.store.data.inbox)||b.store.data.inbox.some(x=>x.chat===c.key&&(inbound?['pending','failed','uncertain']:['pending','failed','delivering','uncertain']).includes(x.status));
  const ids=inbound?[...(turn.voiceRequestIds??[String(turn.voiceRequestId)])]:[];
  const inboundId=turn.voiceRequestId;
  const inboundValid=()=>turn.voiceRequestId===inboundId&&JSON.stringify(turn.voiceRequestIds??[String(turn.voiceRequestId)])===JSON.stringify(ids);
  if(inbound&&(!ids.length||ids.some(id=>! /^-?\d+$/.test(String(id)))))throw Error('当前 QQ 入站事件编号不完整');
  if(b.abort.signal.aborted)return Promise.resolve({status:'deferred',instruction:'请求已取消，不进行合成。'});
  if(b.closed||!b.ready||!cfg.enabled||c.paused||!c.active||c.account!==b.account)throw Error('插件未连接、账号不匹配或聊天已暂停');
  if(!/^[\w-]{1,80}$/.test(id??''))throw Error('requestId 必须是 1–80 位字母、数字、下划线或短横线');
  if(typeof text!=='string'||!text.trim()||[...text].length>(cfg.ttsMaxChars??200))throw Error('合成文本为空或超过长度限制');
  const digest=hash(JSON.stringify({text,voice:VOICE,model:'breeze-tts-2'}));
  const k=`${c.key}:${cfg.dryRun?'preview':'live'}:${id}`,jobs=b.store.data.ttsJobs??={};
  const dir=path.join(b.media.directory,'tts');
  for(const item of Object.values(jobs))if(item.file&&this.now()-item.at>86400000&&path.dirname(item.file)===dir&&/^[a-f0-9]{64}\.mp3$/.test(path.basename(item.file))){try{fs.unlinkSync(item.file);}catch{}delete item.file;}
  const old=jobs[k],triggers=b.store.data.ttsTriggers??={};
  // Preserve old numeric QQ event keys; contact intents use a separate namespace.
  const triggerKeys=inbound?[...new Set(ids.map(id=>`${c.key}:${cfg.dryRun?'preview':'live'}:${id}`))]:[`${c.key}:${cfg.dryRun?'preview':'live'}:contact:${hash(capability.id)}`];
  if(old&&old.digest!==digest)throw Error('requestId 已用于不同合成，请使用新的 ID');
  if(old&&(triggerKeys.some(trigger=>triggers[trigger]!==k)||(old.triggers&&JSON.stringify([...old.triggers].sort())!==JSON.stringify([...triggerKeys].sort()))))throw Error('requestId 已绑定其他 QQ 入站事件，不能跨轮复用');
  if(this.running.has(k))return this.running.get(k);
  if(old){if(old.status==='completed'&&typeof old.file==='string'&&fs.existsSync(old.file)){if(blockedInbox())return Promise.resolve({status:'deferred',instruction:'有待处理消息，音频不应发送；禁止换 ID 重复合成。'});return Promise.resolve({status:'completed',file:old.file,repeated:true});}return Promise.resolve({status:old.status==='preview'?'preview':'uncertain',repeated:true,instruction:'不再重复合成；请用原文文本回复，或先核查供应商记录。'});}
  if(triggerKeys.some(trigger=>triggers[trigger]))return Promise.resolve({status:'already_requested',instruction:'本轮包含已使用的事件或意图，禁止换 ID 重复合成。'});
  if(blockedInbox())return Promise.resolve({status:'deferred',instruction:'有待处理消息，停止合成并先处理新消息。'});
  if(cfg.dryRun){for(const trigger of triggerKeys)triggers[trigger]=k;jobs[k]={digest,status:'preview',at:this.now(),triggers:triggerKeys};b.store.save();return Promise.resolve({status:'preview',instruction:'仅预演，不合成、不发送；需要时用原文文本回复。'});}
  let apiKey;try{apiKey=this.key();}catch{}if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>4096||/[\r\n]/.test(apiKey))return Promise.resolve({status:'unavailable',instruction:'未配置 BREEZE_API_KEY；请用原文文本回复。'});
  const day=new Date(this.now()).toISOString().slice(0,10),quota=b.store.data.ttsQuota??={};const used=Number(quota[day]||0);if(used >= (cfg.ttsDailyLimit??20))return Promise.resolve({status:'limited',instruction:'今日合成额度已用完；请用原文文本回复。'});
  quota[day]=used+1;for(const trigger of triggerKeys)triggers[trigger]=k;const job=jobs[k]={digest,status:'pending',at:this.now(),day,triggers:triggerKeys,...(!inbound?{contact:true}:{})};b.store.save();
  const task=this.perform(job,text,apiKey).then(result=>{if(result.status==='completed'&&(b.turns.get(c.key)!==turn||turn.silent||turn.deferred||!(inbound?inboundValid():contactValid())||b.abort.signal.aborted||b.closed||!b.ready||!b.config().enabled||c.paused||!c.active||blockedInbox())){job.status='suppressed';b.store.save();return {status:'deferred',instruction:'合成已发起且可能已计费，但本轮已失效或有待处理消息；不要发送音频，也不要换 ID 重新合成。'};}if(result.status==='completed'&&!inbound)this.recordCapabilities.set(job,{chat:c.key,turn,valid:contactValid});return result;}).finally(()=>this.running.delete(k));this.running.set(k,task);return task;
 }
 async perform(job,text,apiKey){const b=this.bridge;try{
  const response=await this.fetchImpl(ENDPOINT,{method:'POST',redirect:'error',headers:{'xi-api-key':apiKey,'content-type':'application/json'},body:JSON.stringify({text,model_id:'breeze-tts-2'}),signal:AbortSignal.any([b.abort.signal,AbortSignal.timeout(30000)])});
  if(response.status!==200||!/^audio\/(mpeg|mp3)(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw Error('bad response');
  const limit=10*1048576;if(Number(response.headers.get('content-length'))>limit)throw Error('too large');let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('too large');chunks.push(chunk);}if(!size)throw Error('empty');
  const audio=Buffer.concat(chunks),dir=path.join(b.media.directory,'tts');
  job.file=path.join(dir,hash(Buffer.concat([audio,Buffer.from(job.digest+String(job.at))]))+'.mp3');
  // Persist identity before creating the file: even a crash immediately after
  // write leaves a durable hash which prevents unauthorized later sending.
  if(job.contact){job.contactAudioHash=hash(audio);b.store.save();}
  fs.mkdirSync(dir,{recursive:true});if(!fs.existsSync(job.file))fs.writeFileSync(job.file,audio,{mode:0o600});job.status='completed';b.store.save();return {status:'completed',file:job.file,instruction:'未发送 QQ；可用 nia_qq_media 的 record 发送此文件。'};
 }catch{job.status='uncertain';b.store.save();return {status:'uncertain',instruction:'合成失败或结果未知，可能已计费；不要换 ID 重试，请用原文文本回复。'};}}
}
