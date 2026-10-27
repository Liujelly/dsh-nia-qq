import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { atomicJSON, readJSON } from './store.js';
import { runCommand } from './media.js';

export async function findPython(signal) {
  for (const [cmd, args] of process.platform === 'win32' ? [['py',['-3']],['python',[]],['python3',[]]] : [['python3',[]],['python',[]]]) {
    signal.throwIfAborted();
    try {
      await runCommand(cmd, [...args, '-c', 'import sys,struct; assert (3,9)<=sys.version_info[:2]<=(3,12) and struct.calcsize("P")==8'], {timeoutMs:10000,signal});
      return [cmd,args];
    } catch { signal.throwIfAborted(); }
  }
  throw Error('未找到 Python 3.9–3.12；请安装 64 位 Python 并加入 PATH，重启 DSH 后重试。');
}

export function executeInstaller(python, root, signal, update) {
  return new Promise((resolve,reject)=>{
    const script=fileURLToPath(new URL('../tools/install_asr.py',import.meta.url));
    const child=spawn(python[0],[...python[1],'-u',script,root],{shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
    let buffer='',result,error='安装程序未正常结束，请检查网络后重试。',timedOut=false;
    const kill=()=>{
      if(!child.pid)return;
      if(process.platform==='win32') { const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill()); }
      else { try{process.kill(-child.pid,'SIGKILL');}catch{child.kill();} }
    };
    signal.addEventListener('abort',kill,{once:true});if(signal.aborted)kill();
    const timer=setTimeout(()=>{timedOut=true;kill();},30*60*1000);timer.unref?.();
    child.stderr.resume();
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>65536){error='安装程序输出异常';kill();return;}
      let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{
        const event=JSON.parse(line);if(event.stage==='result')result=event.config;
        else if(event.stage==='error')error=String(event.message).slice(0,300);
        else update(event);
      }catch{/* Dependency diagnostics are not protocol messages. */}}
    });
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',kill);};
    child.on('error',()=>{cleanup();reject(Error('无法启动 Python 安装程序。'));});
    child.on('close',code=>{cleanup();if(signal.aborted)return reject(Error('安装已取消'));if(timedOut)return reject(Error('安装超过 30 分钟，请检查网络后重试。'));
      if(code!==0||!result)return reject(Error(error));resolve(result);});
  });
}

export class AsrInstaller {
  constructor({root,configure,probe=findPython,execute=executeInstaller}) {
    Object.assign(this,{root,configure,probe,execute});this.file=path.join(root,'install-state.json');
    this.state=readJSON(this.file,{status:'idle',stage:'idle'});
    if(this.state.status==='running')this.state={status:'interrupted',stage:'interrupted',error:'上次安装被中断，可以重试。'};
  }
  snapshot(){return {...this.state,root:this.root,running:this.state.status==='running'};}
  save(patch){this.state={...this.state,...patch};atomicJSON(this.file,this.state);}
  start(){
    if(this.closed)throw Error('插件正在关闭');
    if(this.job)return this.snapshot();
    this.controller=new AbortController();const signal=this.controller.signal;
    this.save({status:'running',stage:'python',error:'',received:0,total:0,file:''});
    this.job=(async()=>{
      try {
        const python=await this.probe(signal);signal.throwIfAborted();
        const config=await this.execute(python,this.root,signal,event=>{
          if(signal.aborted)return;
          const {stage,file='',received=0,total=0}=event;
          if(['environment','packages','metadata','download','check'].includes(stage))this.save({stage,file,received,total});
        });
        signal.throwIfAborted();
        if(!config||!['asrExecutable','asrArgs','ffmpegExecutable'].every(k=>typeof config[k]==='string'&&config[k].length>0))throw Error('安装结果不完整');
        // Only these fields may be applied, even if the runner returns extra values.
        await this.configure(Object.fromEntries(['asrExecutable','asrArgs','ffmpegExecutable'].map(k=>[k,config[k]])),signal);
        this.save({status:'installed',stage:'installed',error:'',completedAt:Date.now()});
      } catch(e){this.save({status:signal.aborted?'cancelled':'failed',stage:'stopped',error:signal.aborted?'安装已取消；重试时会复用校验通过的模型。':String(e.message).slice(0,300)});}
      finally {this.job=null;}
    })();
    return this.snapshot();
  }
  cancel(){this.controller?.abort();return this.snapshot();}
  async close(){this.closed=true;this.cancel();await this.job;}
}
