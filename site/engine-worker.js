// Classic worker: Emscripten pthread runtime itself uses importScripts.
const assetVersion=new URL(self.location.href).searchParams.get('v')||'dev';
importScripts('./diagnostics.js?v='+encodeURIComponent(assetVersion));
let M, core, size, stopReason=null, running=false, ready=false;
let phase='worker-start',modelContext=null,searchContext=null;const recentLogs=[];
let chain=Promise.resolve();
const tell=(type,data={})=>postMessage({type,...data});
function fail(e){
  const context={phase,size,ready,running,model:modelContext,search:searchContext,memoryBytes:M?.HEAP32?.buffer.byteLength,recentLogs:[...recentLogs]};
  try {if(M?.getExceptionMessage&&(typeof e==='number'||Number.isInteger(e?.excPtr)||(typeof WebAssembly.Exception==='function'&&e instanceof WebAssembly.Exception)))context.cppException=M.getExceptionMessage(e);}catch(decodeError){context.exceptionDecodeError=KataDiagnostics.describe(decodeError);}
  const diagnostic=KataDiagnostics.report(e,context);
  if(context.cppException)diagnostic.message=context.cppException.join(': ');
  console.error('[KataGo worker exception]',e,diagnostic,JSON.stringify(diagnostic,null,2));
  tell('error',{error:diagnostic.message,diagnostic});
}
self.addEventListener('unhandledrejection',e=>{fail(e.reason);e.preventDefault();});
self.addEventListener('error',e=>fail(e));
function log(message){recentLogs.push(String(message));if(recentLogs.length>100)recentLogs.shift();console.error('[KataGo runtime]',message);tell('diagnostic',{message:String(message)});}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function call(name,args=[],types=args.map(()=> 'number'),async=false){phase=name;return M.ccall(name,'number',types,args,async?{async:true}:undefined);}
function check(ok){if(!ok)throw Error(M.ccall('kgeError','string',[],[])||'KataGo 调用失败');}
function alloc(values){const p=M._malloc(Math.max(4,values.length*4));if(!p)throw Error('WASM 内存不足');M.HEAP32.set(values,p>>2);return p;}
async function init(req){
  core=await import('./core.js?v='+encodeURIComponent(assetVersion));size=req.size;
  modelContext={fileName:req.name,boardSize:size};
  if(!self.crossOriginIsolated)throw Error('未启用跨源隔离，无法运行搜索线程');
  const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('未找到 WebGPU 适配器，请使用支持 WebGPU 的 Chrome / Edge');
  const adapterInfo=adapter.info?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:null;
  tell('status',{message:'校验教师权重 SHA-256…'});
  const hash=await core.sha256(req.bytes);
  modelContext.sha256=hash;
  const suffix=req.name.toLowerCase().match(/(\.bin\.gz|\.txt\.gz|\.bin|\.txt|\.gz)$/)?.[0];
  if(!suffix)throw Error('请选择 KataGo .bin/.txt 或 gzip 权重');
  const modelPath='/teacher'+suffix;
  const decoded=suffix.endsWith('.gz')?new Blob([req.bytes]).stream().pipeThrough(new DecompressionStream('gzip')):new Blob([req.bytes]).stream();
  const reader=decoded.getReader();let header='';while(header.split('\n').length<3&&header.length<4096){const r=await reader.read();if(r.done)break;header+=new TextDecoder().decode(r.value.slice(0,4096));}await reader.cancel();
  const modelName=header.split('\n')[0].trim();
  tell('status',{message:'加载 KataGo WASM 与本地 GPU 权重…'});
  importScripts('./engine/kataeval-mt.js?v='+encodeURIComponent(assetVersion));
  phase='createKata';
  M=await createKata({mainScriptUrlOrBlob:new URL('./engine/kataeval-mt.js?v='+encodeURIComponent(assetVersion),self.location.href).href,locateFile:p=>new URL('./engine/'+p+'?v='+encodeURIComponent(assetVersion),self.location.href).href,print:()=>{},printErr:log,onAbort:s=>fail(Error('WASM 中止：'+s))});
  M.FS.writeFile(modelPath,new Uint8Array(req.bytes));
  check(await call('kgeLoad',[modelPath,size],['string','number'],true));
  // Keep MEMFS bytes: the threaded NNEvaluator opens this path on first evaluation.
  if(!call('kgeBackendIsGpu'))throw Error('引擎退回 CPU；本研究模式要求 WebGPU，未开始分析');
  ready=true;tell('ready',{model:{fileName:req.name,name:modelName,sha256:hash,hashScope:'original-file-bytes',byteLength:req.bytes.byteLength,modelVersion:call('kgeModelVersion'),backend:'WebGPU',precision:'fp32',adapter:adapterInfo}});
}
async function analyze(req){
  if(!ready)throw Error('请先加载权重');if(running)throw Error('搜索仍在运行');
  const s=core.validateSettings(req.settings),p=req.position;searchContext={settings:s,boardSize:p.size,moves:p.moves.length,toPlay:p.toPlay};if(p.size!==size)throw Error('棋盘大小已变化，请重新加载权重');
  running=true;stopReason=null;const allocated=[],ptr=x=>{const v=alloc(x);allocated.push(v);return v;};const frames=[];let lastDecision=null,firstStable=null;
  const started=performance.now();
  try{
    const setup=ptr(p.setup),ml=ptr(p.moves.map(x=>x.loc)),mc=ptr(p.moves.map(x=>x.col));
    check(call('kgrConfigure',[setup,p.initialPla,s.firstVisits,s.growth,s.pvLength,s.moveOwnership?1:0]));
    const b=ptr(Array(size*size).fill(0)),policy=ptr(Array(size*size+1).fill(0)),value=ptr(Array(5).fill(0)),own=ptr(Array(size*size).fill(0));
    check(await call('kgeEvalSeqKata',[ml,mc,p.moves.length,p.toPlay,p.komi,b,policy,value,own],undefined,true));
    if(!call('kgeBackendIsGpu'))throw Error('搜索后端未使用 WebGPU，已拒绝生成教师数据');
    const read=(ptr,n,heap=M.HEAPF32)=>Array.from(heap.slice(ptr>>2,(ptr>>2)+n));
    modelContext.rawValue=read(value,5);
    modelContext.engineBoardSize=call('kgeBoardSize');
    if(modelContext.engineBoardSize!==size)throw Error(`Engine board size ${modelContext.engineBoardSize} does not match requested ${size}`);
    const actual=read(b,size*size,M.HEAP32);if(JSON.stringify(actual)!==JSON.stringify(p.board))throw Error('引擎重放棋盘与界面不一致，已拒绝生成数据');
    tell('raw',{raw:{board:actual,policy:read(policy,size*size+1),value:read(value,5),ownership:read(own,size*size),perspective:'white',valueFields:['whiteWinProb','whiteLossProb','noResultProb','whiteScoreMean','whiteLead']}});
    check(await call('kgeSearchBegin',[ml,mc,p.moves.length,p.toPlay,p.komi,s.maxVisits,s.maxTimeSec*1000,s.threads],undefined,true));
    function drain(){const result=JSON.parse(M.ccall('kgrPoll','string',[],[]));if(result.snapshotError)throw Error(result.snapshotError);
      for(const f of result.frames){core.validateSnapshot(f,size);f.elapsedMs=Math.round(performance.now()-started);frames.push(f);lastDecision=core.convergence(frames,s);if(lastDecision.stable&&!firstStable)firstStable=lastDecision;tell('snapshot',{snapshot:f,convergence:lastDecision});}return result.done;}
    while(true){await wait(80);const done=drain();if(stopReason||done||(s.autoStop&&lastDecision?.stable)){if(!stopReason)stopReason=lastDecision?.stable&&s.autoStop?'observed-stability':done?'budget-exhausted':'unknown';break;}}
    check(call('kgrFinish'));drain();
    if(!frames.length||!frames.at(-1).forcedFinal)throw Error('未取得最终完整快照，不能标记为完成');
    const finalVerification=core.verifyFinal(frames,s);
    if(stopReason==='observed-stability'&&!finalVerification.stable)stopReason='stability-unconfirmed-at-stop';
    const actualVisits=frames.at(-1)?.actualRootVisits??0;
    tell('complete',{reason:stopReason,budgetLimit:stopReason==='budget-exhausted'?(actualVisits>=s.maxVisits?'visits':'time'):null,actualVisits,elapsedMs:Math.round(performance.now()-started),convergence:lastDecision,finalVerification,firstObservedStable:firstStable});
  }catch(e){fail(e);}
  finally{try{call('kgeStopSearch');}catch(e){log(JSON.stringify(KataDiagnostics.report(e,{phase:'cleanup'})));}for(const p of allocated)M._free(p);running=false;}
}
onmessage=e=>{const r=e.data;if(r.type==='stop'){stopReason='manual-stop';return;}chain=chain.then(()=>r.type==='init'?init(r):r.type==='analyze'?analyze(r):Promise.reject(Error('未知请求'))).catch(fail);};
