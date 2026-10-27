window.__ModuleLoader__.load({ id: 'dsh-nia-qq', factory: require=>{
 const React=require('react');
  const CSS = `
  [data-nia-panel]{--n-bg:var(--dsw-alias-bg-layer-1,#fafaf9);--n-line:var(--dsw-alias-border-l2,#8885);--n-muted:var(--dsw-alias-label-tertiary,#888);--n-accent:var(--dsw-alias-state-business-primary,#168575);font:inherit;font-size:13px;line-height:1.65;color:inherit;max-width:920px;padding:8px 4px 28px;box-sizing:border-box}
  [data-nia-panel] *{box-sizing:border-box}[data-nia-panel] h2{font-size:21px;margin:0;font-weight:650}[data-nia-panel] h3{font-size:14px;margin:0 0 12px}[data-nia-panel] p{margin:6px 0}
  [data-nia-panel] .nia-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}[data-nia-panel] .nia-muted{color:var(--n-muted);font-size:12px}[data-nia-panel] .nia-card{border:1px solid var(--n-line);border-radius:10px;background:var(--n-bg);padding:16px;margin:12px 0}
  [data-nia-panel] button,[data-nia-panel] input,[data-nia-panel] textarea{font:inherit;color:inherit;border:1px solid var(--n-line);border-radius:6px;background:var(--n-bg);padding:7px 10px;min-height:34px;max-width:100%}[data-nia-panel] button{cursor:pointer}[data-nia-panel] button:hover{background:color-mix(in srgb,var(--n-accent) 8%,var(--n-bg))}[data-nia-panel] :focus-visible{outline:2px solid var(--n-accent);outline-offset:2px}[data-nia-panel] button:disabled{opacity:.5;cursor:default}
  [data-nia-panel] input:not([type=checkbox]),[data-nia-panel] textarea{width:100%}[data-nia-panel] input[type=checkbox]{min-height:auto;accent-color:var(--n-accent);margin:0 8px 0 0}[data-nia-panel] .nia-field{display:grid;grid-template-columns:minmax(140px, .8fr) minmax(200px,1.5fr);gap:18px;align-items:start;padding:10px 0;border-bottom:1px solid color-mix(in srgb,var(--n-line) 45%,transparent)}
  [data-nia-panel] .nia-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}[data-nia-panel] .nia-stack{display:grid;gap:8px}[data-nia-panel] .nia-tabs{display:flex;gap:4px;border-bottom:1px solid var(--n-line);padding-bottom:8px;flex-wrap:wrap}[data-nia-panel] .nia-tabs button{border-color:transparent;background:transparent}[data-nia-panel] .nia-tabs button[aria-selected=true]{background:color-mix(in srgb,var(--n-accent) 10%,transparent);color:inherit;font-weight:600;border-color:var(--n-line)}
  [data-nia-panel] .nia-save{position:sticky;bottom:0;border:1px solid var(--n-line);border-radius:8px;background:var(--n-bg);padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;z-index:3;box-shadow:0 -3px 12px #00000008}[data-nia-panel] .nia-primary{background:var(--n-accent);color:white;border-color:var(--n-accent)}[data-nia-panel] .nia-primary:hover{filter:brightness(.95)}
  [data-nia-panel] .nia-message{padding:9px 12px;border-left:3px solid var(--n-accent);background:color-mix(in srgb,var(--n-accent) 6%,transparent);white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}[data-nia-panel] [role=alert]{border-color:#c45b4e;color:#bb5147}[data-nia-panel] .nia-empty{padding:18px 0;color:var(--n-muted)}
  [data-nia-panel] .nia-picker{min-width:0}[data-nia-panel] .nia-picker>button{width:100%;text-align:left;display:flex;justify-content:space-between;gap:8px}[data-nia-panel] .nia-picker-list{border:1px solid var(--n-line);padding:8px;margin-top:5px;border-radius:8px;max-height:260px;overflow:auto;background:var(--n-bg)}[data-nia-panel] [role=option]{width:100%;display:block;text-align:left;border:0;white-space:normal;overflow-wrap:anywhere;margin-top:3px}[data-nia-panel] [role=option][aria-selected=true]{background:color-mix(in srgb,var(--n-accent) 12%,transparent)}
  [data-nia-panel] .nia-chip{font-size:11px;border:1px solid var(--n-line);padding:2px 7px;border-radius:5px;white-space:nowrap}[data-nia-panel] .nia-record{padding:12px 0;border-bottom:1px solid var(--n-line)}[data-nia-panel] pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:color-mix(in srgb,var(--n-line) 12%,transparent);padding:10px;border-radius:6px;max-height:320px;overflow:auto}[data-nia-panel] summary{cursor:pointer;padding:5px 0}[data-nia-panel] .nia-number{font-size:34px;font-weight:600;line-height:1.2}[data-nia-panel] .nia-metrics{display:flex;gap:24px;flex-wrap:wrap;margin:12px 0}
  @media(max-width:620px){[data-nia-panel] .nia-field{grid-template-columns:1fr;gap:6px}[data-nia-panel] .nia-card{padding:12px}}`;
  const h = React.createElement;
  const card = (title, ...children) => h('section', {className:'nia-card'}, h('h3',null,title), ...children);
  const note = text => h('p',{className:'nia-muted'},text);
  const empty = text => h('div',{className:'nia-empty'},text);
  const fmt = at => at ? new Date(at).toLocaleString() : '未记录';
  const details = (title,value) => h('details',null,h('summary',null,title),h('pre',null,JSON.stringify(value,null,2)));
  function Picker({label, value, options, onChange, placeholder='请选择', emptyText='暂无可选项，请刷新后重试', disabled=false}) {
    const [open,setOpen] = React.useState(false), [query,setQuery] = React.useState('');
    const selected = options.find(o=>o.value===value);
    return h('div',{className:'nia-picker',onKeyDown:e=>{if(e.key==='Escape')setOpen(false);}},
      h('button',{type:'button','aria-label':label,'aria-expanded':open,'aria-haspopup':'listbox',disabled,onClick:()=>setOpen(!open)},h('span',null,selected?.label || value || placeholder),h('span',{'aria-hidden':true},open?'▴':'▾')),
      open?h('div',{className:'nia-picker-list'},h('input',{'aria-label':'搜索'+label,placeholder:'搜索…',value:query,onChange:e=>setQuery(e.target.value)}),
        h('div',{role:'listbox','aria-label':label},...options.filter(o=>(o.label+' '+o.value).toLowerCase().includes(query.toLowerCase())).map(o=>h('button',{type:'button',role:'option',key:o.value,'aria-selected':o.value===value,onClick:()=>{onChange(o.value);setOpen(false);setQuery('');}},o.label))),
        !options.length?empty(emptyText):null):null);
  }
  const field=(label,control,hint)=>h('div',{className:'nia-field'},h('div',null,h('strong',null,label),hint?note(hint):null),control);
  const tabs=(items,current,set)=>h('div',{className:'nia-tabs',role:'tablist'},...items.map(([id,label])=>h('button',{key:id,role:'tab','aria-selected':current===id,onClick:()=>set(id)},label)));
  const message=(text,error=false)=>text?h('div',{className:'nia-message',role:error?'alert':'status'},text):null;
  const root=(name,...children)=>h('div',{'data-nia-panel':name},h('style',null,CSS),...children);
  const header=(title,subtitle,action)=>h('div',{className:'nia-head'},h('div',null,h('h2',null,title),note(subtitle)),action);
  async function request(base,path,body) {
    const response=await fetch(base+'/'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json',['x-nia-'+base.split('-').at(-1)]:'1'},body:JSON.stringify(body)});
    let data; try {data=await response.json();} catch {throw Error('服务未返回有效数据（HTTP '+response.status+'），请检查插件是否启用。');}
    if(!response.ok || data.ok===false)throw Error(data.error || '请求失败（HTTP '+response.status+'）'); return data;
  }
  const api=(p,b)=>request('/dsh-nia-qq',p,b);
  const statuses={pending:'等待处理',delivering:'正在投递',delivered:'已投递',accepted:'会话已接收',handled:'意图已处理',failed:'未投递成功',uncertain:'结果待核实',discarded:'已忽略',preview:'预演，未外发',sending:'正在发送',confirmed:'已确认'};
  function Panel(){
    const [data,setData]=React.useState(null),[form,setForm]=React.useState(null),[saved,setSaved]=React.useState(null),[tab,setTab]=React.useState('settings');
    const [template,setTemplate]=React.useState(''),[working,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
    const [asr,setAsr]=React.useState({status:'idle',running:false}),[asrError,setAsrError]=React.useState('');
    const busy=working||asr.running;
    const stageNames={idle:'尚未安装',python:'查找 Python',environment:'创建独立语音环境',packages:'安装识别库和音频转换程序',metadata:'获取模型校验信息',download:'下载并校验模型',check:'检查识别器与音频转换',installed:'安装完成 · 路径已保存',interrupted:'上次安装被中断',stopped:'安装已停止'};
    const refresh=async(reset=false)=>{const d=await api('state');setData(d);const f={...d.config,token:''};setSaved(f);if(reset)setForm(f);};
    React.useEffect(()=>{refresh(true).catch(e=>setError(e.message));},[]);
    React.useEffect(()=>{
      if(tab!=='chats')return;
      let active=true,timer;
      const poll=async()=>{try{const d=await api('state');if(active)setData(d);}catch(e){if(active)setError(e.message);}finally{if(active)timer=setTimeout(poll,2000);}};
      poll();return()=>{active=false;clearTimeout(timer);};
    },[tab]);
    React.useEffect(()=>{
      let active=true,wasRunning=false,timer;
      const poll=async()=>{try{const r=await api('asr');if(!active)return;
        if(wasRunning&&!r.asr.running){const d=await api('state');if(!active)return;
          setData(d);setSaved({...d.config,token:''});
          setForm(f=>({...f,...Object.fromEntries(['asrExecutable','asrArgs','ffmpegExecutable'].map(k=>[k,d.config[k]]))}));setNotice('');}
        if(!active)return;wasRunning=!!r.asr.running;setAsr(r.asr);setAsrError('');
      }catch(e){if(active)setAsrError('安装状态暂时无法读取：'+e.message);}finally{if(active)timer=setTimeout(poll,1500);}};
      poll();return()=>{active=false;clearTimeout(timer);};
    },[asr.running]);
    const install=async(action)=>{setBusy(true);setError('');setNotice('');try{const r=await api('asr-install',{action});setAsr(r.asr);}catch(e){setError(e.message);}finally{setBusy(false);}};
    const act=async(fn,text,reset=false)=>{setBusy(true);setError('');setNotice('');try{await fn();await refresh(reset);setNotice(text);}catch(e){setError(e.message);}finally{setBusy(false);}};
    const edit=(key,value)=>{setForm(f=>({...f,[key]:value}));setNotice('');};
    if(!form)return root('qq',header('角色 · QQ','0.5.1'),message(error,true),empty('读取设置中…'),h('button',{onClick:()=>act(()=>refresh(true),'已重新读取')},'重新读取'));
    const dirty=JSON.stringify(form)!==JSON.stringify(saved);
    const text=(key,label,hint,type='text')=>field(label,h('input',{'aria-label':label,type,value:form[key]??'',disabled:busy,autoComplete:type==='password'?'new-password':undefined,onChange:e=>edit(key,type==='number'?e.target.value:e.target.value)}),hint);
    const toggle=(key,label,hint)=>field(label,h('label',null,h('input',{type:'checkbox','aria-label':label,checked:!!form[key],disabled:busy,onChange:e=>edit(key,e.target.checked)}),'启用'),hint);
    const chatName=key=>{const c=data.chats.find(x=>x.key===key);return c?(c.type==='group'?'群 · ':'私聊 · ')+(c.name||c.id):key;};
    const choose=(key,label,options,hint)=>field(label,h('select',{'aria-label':label,value:form[key],disabled:busy,onChange:e=>edit(key,e.target.value)},...options.map(([value,label])=>h('option',{key:value,value},label))),hint);
    const settings=h('div',null,
      card('运行方式',toggle('enabled','QQ 接入','正式启用前，停用旧 QQ Bridge 对同一账号的收发。'),toggle('dryRun','预演模式','接收并调用模型，但不向 QQ 发消息、不改名；使用独立测试会话。'),toggle('cooperate','记忆与情绪联动','由三个角色插件共同提供跨会话经历、情绪和主动联系。')),
      card('SnowLuma 连接',text('wsUrl','WebSocket 地址','使用本机的 OneBot Universal WS 地址。'),text('account','机器人 QQ 号'),text('ownerQQ','你的 QQ 号','用于明确识别你，不会按昵称猜测。'),text('token','接入令牌',data.tokenSet?'已保存令牌，留空会保留原值。':'填写 SnowLuma 配置中的接入令牌。','password')),
      card('角色会话配置',field('从现有会话读取',h('div',{className:'nia-stack'},h(Picker,{label:'模板会话',value:template,options:data.templates.map(t=>({value:t.id,label:t.title||t.id})),onChange:setTemplate,disabled:busy,emptyText:'请先打开角色会话，然后刷新。'}),
        h('button',{disabled:busy||!template,onClick:()=>act(async()=>{const r=await api('template',{sessionId:template});setForm(f=>({...f,...r.template,workspace:f.workspace||r.template.workspace}));},'模板配置已填入，点击保存设置后生效')},'填入模板配置')), '填入模型、预设；已有工作目录会保留，未设置时才采用模板目录。不复制历史或局部人格。'),
        text('provider','模型提供方'),text('model','模型'),text('characterName','角色名','用于新工作区名称、点名判断和联动情绪评估的角色称呼。'),text('workspace','工作目录','新 QQ 会话统一归入这个目录对应的工作区。'),text('personaFile','可选人格文件','完整人设文件的绝对路径；没有则沿用工作目录和预设。'),
        card('接话节奏',choose('batchMode','消息合并方式',[['adaptive','私聊按同人、群聊合看（推荐）'],['sender','同一个人连续发送（原版逻辑）'],['chat','整个聊天一起合并']],'群聊合看保留各自身份，让角色结合几个人的发言接话。'),text('batchMs','停顿等待（毫秒）','从最后一条消息重新计时；默认 3000；0 表示不合并。','number'),
          text('maxBatchMs','最长合并等待（毫秒）','从第一条消息计时；默认 12000，最多合并 20 条，避免连续聊天一直等不到回复。','number'),
          choose('interruptPolicy','群聊打断方式',[['related','相关的新消息才让话（推荐）'],['all','任何新消息都参与让话判断']],'依据当前回应对象、@、称呼和引用判断，不额外调用分类模型；仍可能误判隐含的话题关系。'),
          text('maxReplyYields','群聊最多连续让话次数','默认 2；达到后可先回应已读内容。明确的暂停、纠正不受次数限制，私聊继续等待补充。','number'),
          note('不相关的新消息排队留待下一轮。相关消息让话时取消尚未发送的余段；已发送的消息不会撤回。'),
          toggle('splitReplies','长回复拆段','按空行拆成多条消息；关闭后整段发送，不按字数硬切。'),text('replyIntervalMs','发送间隔（毫秒）','默认 450，可设 0–5000；相关的新消息按让话规则处理。','number')),
        card('群聊参与',choose('groupScope','群消息接收范围',[['all','接收所有人的消息'],['directed','只收你、@ 角色和引用角色的消息']],'接收不等于一定回复。'),toggle('replyGate','群聊回复门槛','提供本轮静默工具，阻止后续发送；不强制取消模型回合。')),
        card('图片与表情',toggle('receiveImages','接收图片','把图片交给 DSH 附件服务；能否看懂取决于模型。'),toggle('sendImages','发送图片','支持发送工具、Markdown 图片和表情包；原图保留 GIF。'),text('imageLimit','每批图片上限','1–10 张，默认 4。','number'),text('imageMaxMB','单张图片上限（MB）','1–30 MB，默认 5。','number'),text('imageRoot','图片根目录','留空按当前 QQ 会话工作目录解析相对路径。')),
        card('语音转写',
          note('把你发来的 QQ 语音转成文字，在本机识别。安装需要 Python 3.9–3.12、网络和磁盘空间；模型约 230 MB，连同环境建议预留 1 GB。'),
          h('div',{className:'nia-record'},h('strong',{role:'status'},stageNames[asr.stage]||'读取安装状态…'),
            asr.stage==='download'?h('div',null,h('progress',{'aria-label':'模型下载进度',max:asr.total||1,value:asr.received||0,style:{width:'100%'}}),note(asr.file+' · '+((asr.received||0)/1048576).toFixed(1)+' / '+((asr.total||0)/1048576).toFixed(1)+' MB')):null,
            asr.running&&asr.stage!=='download'?note('首次安装可能需要几分钟；可以切换页面查看其他状态。'):null,
            message(asr.error,true),message(asrError,true),asr.root?note('安装目录：'+asr.root):null,
            h('div',{className:'nia-row'},asr.running?h('button',{disabled:working,onClick:()=>install('cancel')},'取消安装'):h('button',{className:'nia-primary',disabled:busy||dirty||!!asrError,onClick:()=>install('start')},asr.status==='installed'?'检查 / 修复语音依赖':'一键安装语音依赖')),
            dirty&&!asr.running?note('请先保存或撤销当前修改，再开始安装。'):null,
            note('检查通过后自动保存程序、模型和 FFmpeg 路径；不会自动开启转写。失败或取消时保留原配置。')),
          toggle('asrEnabled','启用语音转写','安装完成后打开此开关，再点击底部保存设置。'),
          h('details',null,h('summary',null,'手动配置 / 查看安装路径'),text('asrExecutable','转写程序','本机 Python 或自定义转写程序的完整路径。'),text('asrArgs','转写参数（JSON 数组）','参数须含 {file}；一键安装会填好模型目录。不通过 shell 执行。'),text('asrTimeoutSec','转写超时（秒）','默认 60。','number'),text('ffmpegExecutable','FFmpeg 程序（可选）','用于把音频转换为本地识别器支持的格式。'))),
        card('恢复与兼容',toggle('autoContinue','上下文超限自动续接','默认开启。先让现有压缩与重试处理，整轮仍超限才交接；一小时内不反复自动切换。交接整理会使用当前模型。'),toggle('historyRecovery','补收断线消息','重连及每分钟检查近段历史；首次启用从当前时间开始，最多读取每个聊天最近 100 条。'),text('historyMinutes','补收时间范围（分钟）','默认 10；超出范围的旧消息不唤醒角色。','number'),toggle('autoForward','自动转发最终回复','恢复原版自动转发方式。默认关闭；同轮已用发送工具发过就不重复转发。'),toggle('onlyQQWake','仅转发 QQ 唤醒的回复','只约束自动转发；你在 DSH 手动输入的回复留在本机。'),toggle('onlyMarked','仅自动转发 [QQ] 块','只转发 [QQ]…[/QQ] 内的文字；发送工具不受此项影响。')),
        h('details',null,h('summary',null,'高级配置'),text('preset','Agent 预设','留空使用默认预设。'),text('personaId','人格标识','继承现有数据时保持原值；改角色名无需修改此标识。'))));
    const chats=card('自动发现的聊天',note('新好友、加入的群和首次私聊会自动登记。平时沿用原会话与现有压缩；自动续接仅在整轮最终上下文超限时触发。'),
      ...data.chats.map(c=>{const usePreview=data.config.cooperate&&data.config.dryRun;return h('div',{key:c.key,className:'nia-record'},h('div',{className:'nia-row'},h('strong',{style:{flex:1}},chatName(c.key)),h('span',{className:'nia-chip'},!c.active?'已离开':c.paused?'已暂停':'接收中'),h('button',{disabled:busy,onClick:()=>act(()=>api('chat',{key:c.key,paused:!c.paused}),c.paused?'聊天已恢复':'聊天已暂停')},c.paused?'恢复聊天':'暂停聊天')),
        note((usePreview?'预演会话：':'正式会话：')+((usePreview?c.previewSessionId:c.sessionId)||'等待首次消息')),
        c.type==='private'?h('div',{className:'nia-row'},h('button',{disabled:busy,onClick:()=>act(()=>api('activity-chat',{key:c.key,paused:!c.activityContactsPaused}),c.activityContactsPaused?'已恢复自主活动发起联系':'已暂停自主活动发起联系')},c.activityContactsPaused?'恢复自主联系':'暂停自主联系'),note(c.activityContactsPaused?'此私聊已暂停自主活动发起联系，普通消息仍可接收。':'允许自主活动发起联系，仍受安静时段约束。')):null,
        (()=>{const job=c.continuations?.[usePreview?'preview':'live'];const active=['queued','preparing','prepared'].includes(job?.status);const wakeUnknown=job?.wake==='uncertain';const names={queued:'等待当前回合结束',preparing:'正在整理交接',prepared:'正在保存新会话',committed:'续接完成',failed:'续接失败，原会话保留',cancelled:'续接已取消'};
          return h('div',null,job?note((names[job.status]||job.status)+' · '+job.reason+(job.wake==='pending'?' · 等待恢复未答复消息':wakeUnknown?' · 恢复结果待核实':'')+(job.error?' · '+job.error:'')):null,
            h('div',{className:'nia-row'},h('button',{disabled:busy||active||wakeUnknown||['pending','delivering'].includes(job?.wake)||!c.active||c.paused||!(usePreview?c.previewCreated:c.created),onClick:()=>act(()=>api('continuation',{key:c.key,action:'start'}),'已安排续接，等待当前回合与操作结束')},'新开并续接'),
              job?.status==='failed'?h('button',{disabled:busy,onClick:()=>act(()=>api('continuation',{key:c.key,action:'retry'}),'已重新安排续接')},'重试续接'):null,
              ['queued','failed'].includes(job?.status)?h('button',{disabled:busy,onClick:()=>act(()=>api('continuation',{key:c.key,action:'cancel'}),'已取消续接，保留原会话')},'取消续接'):null,
              wakeUnknown?h('button',{disabled:busy,onClick:()=>act(()=>api('continuation',{key:c.key,action:'acknowledge'}),'已停止自动恢复，不会重发旧消息')},'停止恢复旧消息'):null),
            ...(c.sessionHistory||[]).slice(-5).map(x=>note((x.mode==='preview'?'预演':'正式')+'旧会话：'+x.id+' → '+x.next)));})(),
        c.temporaryPeer?note('非好友临时私聊：接收实时消息，不调用好友历史接口；这不表示已识别为真人。'):null);}),!data.chats.length?empty('尚未发现聊天。完成连接后会自动读取好友与群。'):null);
    const queue=h('div',null,card('接收消息',note('结果待核实的记录不会自动重放；请先检查对应 DSH 会话。'),...data.queue.filter(x=>x.status!=='discarded').slice(-40).map(x=>h('div',{key:x.key,className:'nia-record'},h('p',null,chatName(x.chat)+' · '+(statuses[x.status]||x.status)),
      h('div',{className:'nia-row'},x.status==='failed'?h('button',{disabled:busy,onClick:()=>act(()=>api('queue',{key:x.key,action:'retry'}),'已重新排队')},'重试'):null,['pending','failed','uncertain'].includes(x.status)?h('button',{disabled:busy,onClick:()=>act(()=>api('queue',{key:x.key,action:'discard'}),'已忽略此记录')},'忽略'):null))),!data.queue.filter(x=>x.status!=='discarded').length?empty('没有待处理消息。'):null),
      card('角色发起的联系',...(data.intents||[]).slice().reverse().map(x=>h('div',{key:x.id,className:'nia-record'},h('p',null,chatName(x.origin)+' → '+chatName(x.target)),h('p',null,x.reason),note((x.preview?'预演 · ':'')+(statuses[x.status]||x.status)),
        x.status==='failed'?h('button',{disabled:busy,onClick:()=>act(()=>api('intent',{id:x.id,action:'retry'}),'联系已重新排队')},'重试联系'):null,
        ['pending','failed','uncertain'].includes(x.status)?h('button',{disabled:busy,onClick:()=>act(()=>api('intent',{id:x.id,action:'discard'}),'联系已忽略')},'忽略联系'):null)),!data.intents?.length?empty('暂时没有主动联系意图。'):null));
    const actions=card('发送与操作记录',note('“意图已处理”不等于已发送；这里的操作确认才表示收到平台回执。'),...data.actions.slice().reverse().map(x=>h('div',{key:x.key,className:'nia-record'},h('div',{className:'nia-row'},h('span',{className:'nia-chip'},statuses[x.status]||x.status),h('strong',null,chatName(x.chat))),h('p',null,x.params?.message?.[0]?.data?.text||x.action),note(fmt(x.at)),x.status==='uncertain'?(x.continuationReviewedAt?note('已核查：仅解除续接等待，仍不代表发送成功，不会重试。'):h('button',{disabled:busy,onClick:()=>act(()=>api('action-review',{key:x.key}),'已解除续接等待，结果仍标记未知，不会重发')},'已核查，解除续接等待')):null,details('查看操作详情',{action:x.action,params:x.params,result:x.result}))),!data.actions.length?empty('暂无操作记录。'):null);
    const save=()=>act(async()=>{const body={...form};for(const key of ['batchMs','maxBatchMs','maxReplyYields','replyIntervalMs','imageLimit','imageMaxMB','asrTimeoutSec','historyMinutes']){if(String(form[key]).trim()===''||!Number.isInteger(Number(form[key])))throw Error('请填写有效的数字设置：'+key);body[key]=Number(form[key]);}await api('config',body);},form.enabled?'设置已保存，连接状态见页首':'设置已保存，QQ 接入保持关闭',true);
    return root('qq',header('角色 · QQ','0.5.1 · '+data.status,h('button',{disabled:busy,onClick:()=>act(async()=>{},'状态已刷新')},'刷新状态')),
      data.error?message(data.error,true):null,tabs([['settings','连接配置'],['chats','聊天'],['queue','消息与联系'],['actions','操作记录']],tab,setTab),message(error,true),message(notice),
      tab==='settings'?settings:tab==='chats'?chats:tab==='queue'?queue:actions,
      h('div',{className:'nia-save'},h('span',{style:{flex:1},role:'status'},busy?'正在处理…':dirty?'有未保存的修改':'设置已同步'),h('button',{disabled:busy||!dirty,onClick:()=>{setForm(saved);setNotice('已撤销未保存修改');}},'撤销修改'),h('button',{className:'nia-primary',disabled:busy||!dirty,onClick:save},'保存设置并重连')));
  }

 return {inject:['slots'],apply(ctx){const slots=ctx.get?.('slots')||ctx.slots;slots.inject('settings.section',()=>slots.register({name:'settings.section',id:'nia-qq',order:42,label:'角色 · QQ'},()=>h(Panel)));}};
}});
