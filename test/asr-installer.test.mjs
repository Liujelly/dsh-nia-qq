import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsrInstaller } from '../lib/asr-installer.js';

const result={asrExecutable:'python',asrArgs:'["script","{file}"]',ffmpegExecutable:'ffmpeg'};
function fixture(t, overrides={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nia-asr-test-'));let applied=[];
  const install=new AsrInstaller({root,probe:async()=>['python',[]],execute:async()=>result,configure:async fields=>applied.push(fields),...overrides});
  t.after(async()=>{await install.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('nia-asr-test-'));fs.rmSync(root,{recursive:true});});
  return {install,applied,root};
}
test('installer only applies checked ASR fields; persists completion without enabling ASR',async t=>{
  const {install,applied,root}=fixture(t,{execute:async(_p,_r,_s,update)=>{update({stage:'download',file:'model',received:5,total:10});return {...result,asrEnabled:true,token:'invalid'};}});
  assert.equal(install.start().running,true);await install.job;
  assert.deepEqual(applied,[result]);assert.equal(install.snapshot().status,'installed');
  const loaded=new AsrInstaller({root});assert.equal(loaded.snapshot().status,'installed');
});
test('concurrent starts coalesce, cancellation waits and prevents config write, retry works',async t=>{
  let starts=0;const {install,applied}=fixture(t,{execute:async(_p,_r,signal)=>{starts++;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return result;}});
  install.start();const job=install.job;install.start();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(starts,1);install.cancel();await job;assert.equal(install.snapshot().status,'cancelled');assert.equal(applied.length,0);
  install.execute=async()=>result;install.start();await install.job;assert.equal(applied.length,1);
});
test('failure and incomplete runner result preserve previous configuration',async t=>{
  const {install,applied}=fixture(t,{execute:async()=>{throw Error('模型校验失败');}});
  install.start();await install.job;assert.equal(install.snapshot().status,'failed');assert.equal(applied.length,0);
  install.execute=async()=>({asrExecutable:'python'});install.start();await install.job;assert.equal(applied.length,0);
});
test('plugin shutdown cancels work and rejects further installs',async t=>{
  const {install,applied}=fixture(t,{probe:async signal=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return ['python',[]];}});
  install.start();await install.close();assert.equal(applied.length,0);assert.throws(()=>install.start(),/关闭/);
});
test('interrupted persisted installs are retryable and never resume automatically',async t=>{
  const {root}=fixture(t);fs.writeFileSync(path.join(root,'install-state.json'),JSON.stringify({status:'running'}));
  const loaded=new AsrInstaller({root});assert.equal(loaded.snapshot().status,'interrupted');assert.equal(loaded.snapshot().running,false);
});
