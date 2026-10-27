// Transport-level turn taking. This uses participants/references, not a second LLM.
const correction = /先别发|别发了|不要发|等我说完|等一下|等会儿|等等|停一下|停止回复|我说错|说错了|纠正|更正|不对[，,。！!\s]|^不对$|改成|不是.{0,40}而是/u;
function named(event,name){
  if(!name)return false;
  const text=(event.bodyText??event.text??'').trim();
  return text===name||text.startsWith(name+'，')||text.startsWith(name+',')||text.startsWith(name+' ')||text.startsWith(name+'：')||text.startsWith(name+':');
}
export class Rhythm {
  constructor(bridge){this.b=bridge;this.yields=new Map();}
  begin(c,items=[],inputId){
    const previous=this.b.turns.get(c.key);
    if(!previous?.deferred||Date.now()-previous.at>60000)this.yields.delete(c.key);
    const messages=items.map(x=>({id:String(x.event.message_id),user:String(x.event.user_id),direct:!!x.event.mentioned||named(x.event,this.b.config().characterName)}));
    const directed=messages.filter(m=>m.direct);
    const focus=directed.length?directed:messages.slice(-1);
    const turn={at:Date.now(),qq:true,silent:false,sent:false,mentioned:directed.length>0,
      inputId,awaitingInput:true,messages,focusIds:focus.map(m=>m.id),focusUsers:[...new Set(focus.map(m=>m.user))]};
    this.b.turns.set(c.key,turn);return turn;
  }
  focus(turn,ids){
    if(ids===undefined)return;
    if(!turn?.qq)throw Error('当前是 DSH 会话输入，不是 QQ 新消息轮次；没有可选的本轮 QQ 消息编号。如确实需要向当前 QQ 聊天发送，请去掉 focusMessageIds 并使用新的 requestId。');
    if(!Array.isArray(ids)||ids.length<1||ids.length>20||ids.some(x=>typeof x!=='string'||!turn?.messages?.some(m=>m.id===x)))throw Error('focusMessageIds 只能选择本轮已经读到的 1–20 条消息编号');
    // Once a turn yields, selecting another target must not reopen its stale replies.
    if(turn.deferred)return;
    turn.focusIds=[...new Set(ids)];turn.focusUsers=[...new Set(turn.messages.filter(m=>ids.includes(m.id)).map(m=>m.user))];
  }
  classify(c,turn,item){
    const e=item.event;
    if(c.type==='private')return {related:true,hard:correction.test(e.bodyText??e.text??'')};
    const direct=e.mentioned||named(e,this.b.config().characterName);
    const reference=!!e.replyTo&&turn?.focusIds?.includes(e.replyTo);
    const others=(e.atIds||[]).some(id=>id!==c.account&&id!=='all')||!!e.replyTo&&!reference&&!e.mentioned;
    const followup=turn?.focusUsers?.includes(e.user_id)&&!others;
    const related=this.b.config().interruptPolicy==='all'||!!(direct||reference||followup);
    return {related,hard:related&&correction.test(e.bodyText??e.text??'')};
  }
  beforeSend(c,turn,focus=turn){
    if(turn?.deferred)return turn.deferred;
    const pending=this.b.pendingMessages(c);
    if(!pending.length)return null;
    const relevant=pending.filter(item=>this.classify(c,focus,item).related);
    if(!relevant.length)return null;
    const hard=relevant.some(item=>this.classify(c,focus,item).hard);
    const count=this.yields.get(c.key)||0;
    // A bounded number of ordinary group interruptions; explicit corrections always win.
    if(c.type==='group'&&!hard&&count>=(this.b.config().maxReplyYields??2))return null;
    const result={status:'deferred',sent:false,reason:hard?'correction':'followup',
      instruction:hard?'收到相关的暂停或纠正。此条未发送，结束本轮，读完补充后重新决定。':'当前对象补充了消息或有人直接找你。此条未发送；结束本轮，下一轮读完补充再接话。不要换 ID 重发旧回复。'};
    if(turn){turn.deferred=result;if(!hard)this.yields.set(c.key,count+1);}
    return result;
  }
  sent(c){this.yields.delete(c.key);}
}
