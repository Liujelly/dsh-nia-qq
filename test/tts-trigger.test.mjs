import test from 'node:test';
import assert from 'node:assert/strict';
import {Rhythm} from '../lib/rhythm.js';
test('only real admitted QQ messages authorize voice, including normal private and unmentioned group chat',()=>{
 const b={turns:new Map(),config:()=>({characterName:'小鲸鱼'})},r=new Rhythm(b),c={key:'k',account:'123',type:'group'};
 const item=(id,text)=>({event:{message_id:id,user_id:'2',bodyText:text,atIds:[]}});
 for(const type of ['private','group']) for(const text of ['你好','/语音 你好']) {
  const turn=r.begin({...c,type},[item('1',text)],'in',true);
  assert.equal(turn.voiceRequestId,'1');assert.deepEqual(turn.voiceRequestIds,['1']);
 }
 assert.equal(r.begin(c,[item('1','hi')],'continuation').voiceRequestId,undefined);
 assert.equal(r.begin(c,[item('1','hi'),item(undefined,'hi')],'in',true).voiceRequestId,undefined);
 assert.deepEqual(r.begin(c,[item('2','a'),item('1','b'),item('2','c')],'in',true).voiceRequestIds,['2','1']);
});
