import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import {fileURLToPath} from 'node:url';
import {atomicJSON,readJSON} from './store.js';

const cut = (v, n=4000) => String(v ?? '').slice(0,n);
export function segments(message) {
  if (Array.isArray(message)) return message.slice(0,100).map(s=>({type:cut(s.type,30),data:Object.fromEntries(Object.entries(s.data||{}).filter(([k,v])=>['text','qq','id','file','url','summary','emoji_id','data'].includes(k)&&['string','number'].includes(typeof v)).map(([k,v])=>[k,cut(v,k==='file'?45*1024*1024:65536)]))}));
  const decode=s=>s.replace(/&#44;/g,',').replace(/&#91;/g,'[').replace(/&#93;/g,']').replace(/&amp;/g,'&');
  const out=[];let at=0;const text=cut(message,65536);
  for(const m of text.matchAll(/\[CQ:([a-z_]+)((?:,[^\]]*)?)\]/g)) {
    if(m.index>at)out.push({type:'text',data:{text:decode(text.slice(at,m.index))}});
    const data={};for(const pair of m[2].slice(1).split(',')){const i=pair.indexOf('=');if(i>0)data[pair.slice(0,i)]=decode(pair.slice(i+1));}
    out.push({type:m[1],data});at=m.index+m[0].length;
  }
  if(at<text.length)out.push({type:'text',data:{text:decode(text.slice(at))}});
  return out.slice(0,100);
}

export function imageType(b) {
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['image/png','png'];
  if(b[0]===255&&b[1]===216&&b[2]===255)return ['image/jpeg','jpg'];
  if(/^GIF8[79]a/.test(b.subarray(0,6).toString()))return ['image/gif','gif'];
  if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return ['image/webp','webp'];
  throw Error('不支持的图片格式');
}
function privateAddress(ip) {
  if(ip.includes(':'))return !/^[23][0-9a-f]{0,3}:/i.test(ip); // global IPv6 only; rejects mapped IPv4
  const [a,b]=ip.split('.').map(Number);return a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19);
}
export async function download(url, limit, signal) {
  for(let hop=0;hop<4;hop++){
    const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('媒体地址无效');
    const addresses=await lookup(u.hostname.replace(/^\[|\]$/g,''),{all:true});
    if(!addresses.length||addresses.some(x=>privateAddress(x.address)))throw Error('不从聊天媒体链接访问内网地址');
    const r=await fetch(u,{redirect:'manual',signal});
    if(r.status>=300&&r.status<400){await r.body?.cancel();url=new URL(r.headers.get('location'),u).href;continue;}
    if(!r.ok)throw Error('媒体下载失败');
    if(Number(r.headers.get('content-length'))>limit){await r.body?.cancel();throw Error('媒体超过大小限制');}
    let size=0;const chunks=[];
    for await(const chunk of r.body){size+=chunk.length;if(size>limit)throw Error('媒体超过大小限制');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  throw Error('媒体重定向过多');
}
function fileBytes(file,limit){const stat=fs.statSync(file);if(!stat.isFile()||stat.size>limit)throw Error('媒体文件过大或不存在');return fs.readFileSync(file);}
export function runCommand(command,args,{timeoutMs=60000,signal}={}) {
  return new Promise((resolve,reject)=>{
    let child,output='',settled=false;
    const finish=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);e?reject(e):resolve(v);};
    const abort=()=>{child?.kill();finish(Error('转写已取消'));};
    const timer=setTimeout(()=>{child?.kill();finish(Error('转写超时'));},timeoutMs);
    if(signal?.aborted)return abort();signal?.addEventListener('abort',abort,{once:true});
    try{child=spawn(command,args,{shell:false,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});}catch{return finish(Error('无法启动转写程序'));}
    child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{output+=b;if(output.length>65536){child.kill();finish(Error('转写输出过大'));}});
    child.stderr.resume();child.on('error',()=>finish(Error('无法启动转写程序')));child.on('close',code=>finish(code===0?null:Error('转写程序失败'),output.trim()));
  });
}

export class Media {
  constructor({directory,api,config,attachments,fetchBytes=download,run=runCommand}){
    Object.assign(this,{directory,api,config,attachments,fetchBytes,run});this.abort=new AbortController();this.originalsFile=path.join(directory,'originals.json');this.originals=new Map(Object.entries(readJSON(this.originalsFile,{})));
  }
  stop(){this.abort.abort();}
  get signal(){return AbortSignal.any([this.abort.signal,AbortSignal.timeout(20000)]);}
  save(b,ext){fs.mkdirSync(this.directory,{recursive:true});const file=path.join(this.directory,createHash('sha256').update(b).digest('hex')+'.'+ext);if(!fs.existsSync(file))fs.writeFileSync(file,b,{mode:0o600});return file;}
  async bytes(data,{trusted=false,audio=false}={}){
    const limit=(audio?30:this.config().imageMaxMB??5)*1048576;
    const source=String(data.url||data.file||data.path||'');
    if(data.base64||source.startsWith('base64://')){const raw=data.base64||source.slice(9);if(raw.length>limit*1.4)throw Error('媒体过大');const b=Buffer.from(raw,'base64');if(b.length>limit)throw Error('媒体过大');return b;}
    if(/^https?:\/\//i.test(source))return this.fetchBytes(source,limit,this.signal);
    if(trusted&&source)return fileBytes(source.startsWith('file:')?fileURLToPath(source):source,limit);
    throw Error('没有可读取的媒体地址');
  }
  async image(data){
    let b;try{b=await this.bytes(data);}catch{
      if(!data.file)throw Error('图片读取失败');
      const resolved=await this.api.call('get_image',{file:data.file});b=await this.bytes(resolved||{},{trusted:true});
    }
    const [mediaType,ext]=imageType(b);return {path:this.save(b,ext),mediaType};
  }
  async voice(data){
    const cfg=this.config();if(!cfg.asrEnabled)return '[语音（未开启转写）]';
    if(!cfg.asrExecutable)return '[语音（尚未配置转写程序）]';
    try{
      let b,ext='amr';
      try{const r=await this.api.call('get_record',{file:String(data.file||data.url||''),out_format:'wav'});b=await this.bytes(r||{},{trusted:true,audio:true});ext='wav';}
      catch{b=await this.bytes(data,{audio:true});const m=/\.(wav|mp3|ogg|silk|amr|flac|m4a)(?:\?|$)/i.exec(String(data.url||data.file));ext=m?.[1]?.toLowerCase()||'amr';}
      let file=this.save(b,ext);
      if(ext!=='wav'&&cfg.ffmpegExecutable){const target=path.join(this.directory,randomUUID()+'.wav');await this.run(cfg.ffmpegExecutable,['-y','-i',file,'-ar','16000','-ac','1',target],{timeoutMs:30000,signal:this.abort.signal});file=target;}
      const args=JSON.parse(cfg.asrArgs||'[]').map(v=>v.replaceAll('{file}',file));
      const text=await this.run(cfg.asrExecutable,args,{timeoutMs:(cfg.asrTimeoutSec??60)*1000,signal:this.abort.signal});
      return text?'[语音转写] '+cut(text,6000):'[语音（转写没有输出）]';
    }catch{return '[语音（转写失败，请检查转写程序、模型和音频格式）]';}
  }
  async decode(message,options={}){
    const state=options.state||{images:[],nodes:0,chars:0,visited:new Set()};const depth=options.depth||0;const lines=[];
    for(const s of segments(message)){
      if(state.chars>=16000)break;const d=s.data||{};let text='';
      if(s.type==='text')text=cut(d.text,16000-state.chars);
      else if(s.type==='at')text=`[提及 ${cut(d.qq,30)}]`;
      else if(s.type==='face')text=`[QQ 表情 ${cut(d.id,20)}]`;
      else if(['image','mface'].includes(s.type)){
        if(this.config().receiveImages!==false&&depth<=1&&state.images.length<(state.limit??this.config().imageLimit??4)){
          try{const im=await this.image(d);state.images.push(im);text=`[图片 ${im.path}]`;}catch{text='[图片/表情未读取'+(d.summary?'：'+cut(d.summary,80):'')+']';}
        }else text='[图片/表情]';
      }else if(s.type==='record')text=depth===0?await this.voice(d):'[语音]';
      else if(s.type==='reply'){
        text=`[引用消息 ${cut(d.id,30)}]`;
        if(depth===0&&/^-?\d+$/.test(String(d.id))){try{const r=await this.api.call('get_msg',{message_id:Number(d.id)});const q=await this.decode(r.message||'',{state:{images:[],nodes:0,chars:0,visited:new Set()},depth:2});text+=` ${cut(r.sender?.nickname||r.user_id,80)}：${q.text.slice(0,1200)}`;}catch{text+='（原文暂不可取）';}}
      }else if(s.type==='forward'){
        const id=String(d.id||'');text='[合并转发]';
        if(depth<2&&id&&!state.visited.has(id)&&state.nodes<30){state.visited.add(id);try{
          const r=await this.api.call('get_forward_msg',{id,message_id:id});const nodes=r.messages||r.data?.messages||[];
          for(const n of nodes){if(state.nodes++>=30||state.chars>=16000)break;const q=await this.decode(n.content||n.message||n.data?.content||'',{state,depth:depth+1});text+='\n'+cut(n.sender?.nickname||n.data?.name||n.user_id||'某人',80)+'：'+q.text;}
          if(!nodes.length)text+='（内容暂不可取）';
        }catch{text+='（展开失败）';}}else text+='（达到展开上限）';
      }else if(s.type==='json'||s.type==='xml')text=cardText(d.data,s.type);
      else text=`[${({video:'视频',file:'文件',poke:'戳一戳'})[s.type]||'非文本内容'}]`;
      lines.push(text);state.chars+=text.length;
    }
    return {text:lines.join('\n').slice(0,16000),images:state.images};
  }
  async content(text,images){
    const base=[{type:'text',text}];if(!images.length)return base;
    if(!this.attachments?.admitPromptContent)return [{type:'text',text:text+'\n宿主未提供图片附件服务；仅保存原图路径，不代表已经看过图片。'}];
    try{
      const blocks=images.slice(0,this.config().imageLimit??4).map(im=>({type:'image',data:fileBytes(im.path,(this.config().imageMaxMB??5)*1048576).toString('base64'),mediaType:im.mediaType,name:path.basename(im.path)}));
      const result=await this.attachments.admitPromptContent([...base,...blocks]);let i=0;
      for(const b of result)if(b.type==='image'&&b.attachment){const original=images[i++]?.path;if(original){this.originals.set(b.attachment.attachmentId,original);const host=this.attachments.imageHostPath?.(b.attachment);if(host)this.originals.set(host,original);}}
      atomicJSON(this.originalsFile,Object.fromEntries(this.originals));
      return result;
    }catch{return [{type:'text',text:text+'\n图片附件交付失败，本轮不能声称看到了图片。'}];}
  }
  async outbound(source,cwd,kind='image'){
    if(kind==='image'&&this.config().sendImages===false)throw Error('发图已关闭');
    source=this.originals.get(source)||source;
    if(source.startsWith('file:'))source=fileURLToPath(source);
    const limit=(kind==='record'?30:this.config().imageMaxMB??5)*1048576;
    let b;
    if(/^https?:\/\//i.test(source))b=await this.fetchBytes(source,limit,this.signal);
    else {const file=path.resolve(this.config().imageRoot||cwd||'',source);b=fileBytes(file,limit);}
    if(kind==='image')imageType(b);
    return {type:kind,data:{file:'base64://'+b.toString('base64')}};
  }
}

export function cardText(raw,type){
  const text=cut(raw,16000),found=[];
  if(type==='json'){try{
    const walk=(x,depth=0)=>{if(depth>6||found.length>15)return;if(typeof x==='string'){if(x.length<2000)found.push(x);}else if(x&&typeof x==='object')for(const [k,v]of Object.entries(x)){if(/title|desc|prompt|url|jump|content|meta|detail|news|music|video|bvid/i.test(k))walk(v,depth+1);}};
    walk(JSON.parse(text));
  }catch{}}
  else {for(const m of text.matchAll(/<(?:title|summary|des)\b[^>]*>([\s\S]*?)<\//g))found.push(m[1].replace(/<!\[CDATA\[|\]\]>/g,''));for(const m of text.matchAll(/(?:url|jumpUrl)=["']([^"']+)["']/g))found.push(m[1]);}
  for(const m of text.matchAll(/BV[0-9A-Za-z]{10}/g))found.push(m[0]);
  return '[分享卡片] '+([...new Set(found)].join(' · ').slice(0,2400)||'内容未识别');
}

export function splitMessage(text,enabled=true){return (enabled?String(text).split(/\n\s*\n/):[String(text)]).map(x=>x.trim()).filter(Boolean);}
export function extractImages(text){const images=[];const clean=String(text).replace(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g,(_,a,b)=>{images.push(a||b);return '';});return {text:clean,images};}
