import {plain,validateSettings} from './core.js';
import {save,download} from './storage.js';
import {batchPlan,createBatchRecord,finishBatchRecord,batchJsonl} from './batch-plan.js';
import {rememberDirectory,lastDirectory} from './directory-store.js';

function searchPosition(worker,position,settings,signal,callbacks){
  return new Promise((resolve,reject)=>{
    let final=false,settled=false;
    const clean=()=>{worker.removeEventListener('message',message);worker.removeEventListener('error',error);signal.removeEventListener('abort',abort);};
    const done=(err,result)=>{if(settled)return;settled=true;clean();err?reject(err):resolve(result);};
    const abort=()=>{worker.postMessage({type:'stop'});done(new DOMException('整盘任务已停止','AbortError'));};
    const error=e=>done(Error(e.message||'KataGo Worker 异常'));
    const message=({data:m})=>{try{
      if(m.type==='raw')callbacks.raw(m.raw);
      if(m.type==='snapshot'){callbacks.snapshot(m.snapshot,m.convergence);if(m.snapshot.forcedFinal)final=true;}
      if(m.type==='progress')callbacks.progress(m.progress);
      if(m.type==='error')done(Object.assign(Error(m.diagnostic?.message||m.error),{diagnostic:m.diagnostic}));
      if(m.type==='complete')done(final?null:Error('缺少最终完整教师快照'),m);
    }catch(e){done(e);}};
    if(signal.aborted){abort();return;}
    worker.addEventListener('message',message);worker.addEventListener('error',error);signal.addEventListener('abort',abort,{once:true});
    worker.postMessage({type:'analyze',position,settings});
  });
}
async function writeFile(dir,name,content){const file=await dir.getFileHandle(name,{create:true});const stream=await file.createWritable();try{await stream.write(content);await stream.close();}catch(e){await stream.abort().catch(()=>{});throw e;}}
async function writeDataset(dir,files){const file=await dir.getFileHandle('dataset.jsonl',{create:true}),stream=await file.createWritable();try{
  for(const name of files){const source=await dir.getFileHandle(name);await stream.write(await(await source.getFile()).text());await stream.write('\n');}
  await stream.close();
}catch(e){await stream.abort().catch(()=>{});throw e;}}

export function mountBatchAnalysis(api){
  const $=id=>document.getElementById(id);let chosen=null,active=false,cancel=null,wakeLock=null;
  const say=t=>$('batchStatus').textContent=t;
  const controls=()=>{const blocked=active||api.context().busy;$('batchStart').disabled=blocked;$('batchPickFolder').disabled=blocked;$('batchDestination').disabled=blocked;$('batchVisits').disabled=blocked;$('batchTime').disabled=blocked;$('batchThreads').disabled=blocked;$('batchCancel').disabled=!active;};
  lastDirectory().then(h=>{if(h){chosen=h;say(`已记住文件夹“${h.name}”。开始时浏览器可能再次请求写入许可。`);}}).catch(e=>say('无法读取上次文件夹：'+e.message));
  $('batchPickFolder').onclick=async()=>{
    if(!window.showDirectoryPicker){say('此浏览器禁用了文件夹授权；可改用“完成后浏览器下载 JSONL”。');return;}
    try{const h=await window.showDirectoryPicker({id:'katago-teacher-output',mode:'readwrite'});chosen=h;await rememberDirectory(h);$('batchDestination').value='folder';say(`输出文件夹：${h.name}。开始后每个局面自动写入。`);}
    catch(e){if(e.name!=='AbortError')say('选择文件夹失败：'+e.message);}
  };
  $('batchStart').onclick=async()=>{
    if(active||api.context().busy)return;
    let folder=null,run=null,files=[],records=[];
    try{
      const ctx=api.context();if(!ctx.game||!ctx.source)throw Error('请先上传 SGF');if(!ctx.worker||!ctx.model)throw Error('请先加载匹配棋盘尺寸的教师权重');if(ctx.game.size!==ctx.model.boardSize&&ctx.model.boardSize!==undefined)throw Error('棋谱与权重加载时的棋盘尺寸不同');if(!ctx.manifest)throw Error('引擎来源清单尚未加载');
      const plan=batchPlan(ctx.game);
      const settings=validateSettings({...ctx.settings,maxVisits:Number($('batchVisits').value),maxTimeSec:Number($('batchTime').value),threads:Number($('batchThreads').value),autoStop:false});
      const mode=$('batchDestination').value;
      if(mode==='folder'){
        if(!chosen)throw Error('先点击“选择输出文件夹”授权，或使用浏览器下载模式');
        // Permission prompts require the user gesture of this Start click.
        if(await chosen.requestPermission({mode:'readwrite'})!=='granted')throw Error('没有获得文件夹写入权限');
        folder=await chosen.getDirectoryHandle(`katago-${new Date().toISOString().slice(0,10)}-${crypto.randomUUID().slice(0,8)}`,{create:true});
      }
      active=true;api.setBatchActive(true);api.lock(true);$('stop').disabled=true;cancel=new AbortController();controls();
      try{wakeLock=await navigator.wakeLock?.request('screen')??null;}catch(e){console.warn('Screen wake lock unavailable; keep the computer awake during batch analysis',e);}
      run={schema:'katago-batch/1.0',id:crypto.randomUUID(),createdAt:new Date().toISOString(),state:'running',teacher:plain(ctx.model),engine:plain(ctx.manifest),sourceSGF:{fileName:ctx.source.fileName,sha256:ctx.source.sha256},settings,boardSize:ctx.game.size,totalPositions:plan.length,completedPositions:0,files:[]};
      $('batchProgress').max=plan.length;$('batchProgress').value=0;
      if(folder)await writeFile(folder,'run.json',JSON.stringify(run,null,2));
      for(const entry of plan){
        if(cancel.signal.aborted)throw new DOMException('整盘任务已停止','AbortError');
        const record=await createBatchRecord({batchId:run.id,entry,total:plan.length,teacher:ctx.model,engine:ctx.manifest,sourceSGF:ctx.source,settings});
        api.showPosition(entry,record);say(`正在搜索第 ${entry.ply} / ${plan.length-1} 手后的局面 · 已完成 ${run.completedPositions}/${plan.length}`);
        const result=await searchPosition(ctx.worker,entry.position,settings,cancel.signal,{raw:r=>api.showRaw(r,record),snapshot:(s,c)=>api.showSnapshot(s,c,record),progress:p=>api.showProgress(p)});
        finishBatchRecord(record,result);api.finishPosition();
        const filename=`position-${String(entry.ply).padStart(4,'0')}.json`;
        // Each position is durable before the next search starts.
        if(folder)await writeFile(folder,filename,JSON.stringify(record));
        try{await save(plain(record));}catch(e){if(!folder)throw e;console.warn('IndexedDB checkpoint failed; output folder remains authoritative',e);}
        if(!folder)records.push(record);else files.push(filename);
        run.files.push({ply:entry.ply,nodeId:entry.nodeId,file:filename,id:record.id,visits:record.result.actualVisits});run.completedPositions++;
        $('batchProgress').value=run.completedPositions;
        if(folder)await writeFile(folder,'run.json',JSON.stringify(run,null,2));
        say(`已保存 ${run.completedPositions}/${plan.length} 个局面；刚完成 ${record.result.actualVisits.toLocaleString()} Visits。`);
      }
      run.state='complete';run.completedAt=new Date().toISOString();
      if(folder){await writeDataset(folder,files);await writeFile(folder,'run.json',JSON.stringify(run,null,2));say(`整盘完成：${plan.length} 个局面；已写入“${folder.name}”的 dataset.jsonl 和逐局面 JSON。`);}
      else {download(`katago-batch-${run.id}.jsonl`,batchJsonl(records),'application/x-ndjson');say(`整盘完成：${plan.length} 个局面；浏览器已发起 JSONL 下载，保存位置由浏览器决定。`);}
    }catch(e){if(run){run.state=e.name==='AbortError'?'cancelled':'error';run.error=e.message;run.completedAt=new Date().toISOString();if(folder)try{await writeFile(folder,'run.json',JSON.stringify(run,null,2));}catch(writeError){console.error('Could not write batch failure manifest',writeError);}}
      if(active)api.release();say(`${e.name==='AbortError'?'已停止':'整盘任务失败'}：${e.message}${run?.completedPositions?`；此前 ${run.completedPositions} 个局面已保存。`:''}`);console.error('[KataGo batch]',e);
    }finally{try{await wakeLock?.release();}catch{}wakeLock=null;if(active){active=false;api.setBatchActive(false);api.lock(false);}controls();}
  };
  $('batchCancel').onclick=()=>{cancel?.abort();$('batchCancel').disabled=true;};
  window.addEventListener('beforeunload',e=>{if(active){e.preventDefault();e.returnValue='';}});
  window.addEventListener('katago-busy',controls);controls();
}
