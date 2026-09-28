// Optional hardware regression. Install playwright-core under .tools/browser-test first.
// Uses an installed Chrome/Edge and the real local model; no weights go to the network.
import {chromium} from '../.tools/browser-test/node_modules/playwright-core/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const model=path.resolve(process.env.KATAGO_TEST_MODEL||'.tools/models/kata9x9-b18c384nbt-20231025.bin.gz');
const site=path.resolve(process.env.KATAGO_TEST_SITE||'site');
const channel=process.env.KATAGO_TEST_BROWSER||'chrome';
const size=Number(process.env.KATAGO_TEST_SIZE||9),visits=Number(process.env.KATAGO_TEST_VISITS||128);
const desired=(process.env.KATAGO_TEST_THREADS||'1,4,4').split(',').map(Number);
const modelHash=crypto.createHash('sha256').update(fs.readFileSync(model)).digest('hex');
const server=http.createServer((req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Cache-Control','no-store');
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<html><body>Real WebGPU regression</body></html>');return;}
  const file=pathname==='/__model'?model:path.resolve(site,'.'+decodeURIComponent(pathname));
  if((pathname!=='/__model'&&!file.startsWith(site+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');fs.createReadStream(file).pipe(res);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({channel,headless:true});
  const page=await browser.newPage();const logs=[];
  page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push(e.stack));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const runs=await page.evaluate(async({size,visits,desired})=>{
    const {DEFAULTS}=await import('/core.js');const bytes=await(await fetch('/__model')).arrayBuffer();
    const all=[];
    // First worker: one then four threads, then another search on the same evaluator.
    // Second worker: reload the exact same file and search again.
    for(const threadCounts of [desired,[desired.at(-1)]]) {
      const w=new Worker('/engine-worker.js');let teacher;
      const exchange=(request,done)=>new Promise((resolve,reject)=>{
        const messages=[];let failure=null;
        const cleanup=()=>{clearTimeout(timer);w.onmessage=null;w.onerror=null;};
        const timer=setTimeout(()=>{cleanup();reject(Error('Real GPU test timed out'))},240000);
        w.onerror=e=>{cleanup();reject(Error(e.message))};
        w.onmessage=({data:m})=>{messages.push(m);if(m.type==='error')failure=m;
          if(failure){cleanup();reject(Error(JSON.stringify(messages)));return;}
          if(m.type===done){cleanup();resolve(messages);}};
        w.postMessage(request);
      });
      try {
        teacher=(await exchange({type:'init',name:'kata9x9-b18c384nbt-20231025.bin.gz',size,bytes},'ready')).at(-1).model;
        for(const threads of threadCounts){
          const position={size,setup:Array(size*size).fill(0),board:Array(size*size).fill(0),moves:[],initialPla:1,toPlay:1,komi:7.5};
          const settings={...DEFAULTS,maxVisits:visits,maxTimeSec:120,threads,autoStop:false};
          const messages=await exchange({type:'analyze',position,settings},'complete');
          all.push({teacher,position,settings,messages});
        }
      } finally {w.terminate();}
    }
    return all;
  },{size,visits,desired});
  const summary=[];
  for(const run of runs){
    assert.equal(run.teacher.backend,'WebGPU');assert.equal(run.teacher.sha256,modelHash);
    const raw=run.messages.find(m=>m.type==='raw').raw;
    const f=run.messages.filter(m=>m.type==='snapshot').at(-1).snapshot;
    assert(f.forcedFinal);assert(f.actualRootVisits>=visits);
    for(const [arr,n] of [[raw.policy,size*size+1],[raw.value,5],[raw.ownership,size*size],[f.policy,size*size+1],[f.ownership,size*size]]){assert.equal(arr.length,n);assert(arr.every(Number.isFinite));}
    assert(f.moveInfos.some(m=>m.visits>0&&m.pv.length>0));assert(Object.values(f.rootValue).every(Number.isFinite));
    assert(f.moveInfos.some(m=>m.ownership?.length===size*size));
    if(run.settings.threads>1)assert(f.nnRowsProcessed>f.nnBatchesProcessed,'Must exercise batches larger than one');
    summary.push({threads:run.settings.threads,visits:f.actualRootVisits,candidates:f.moveInfos.length,policy:f.policy.length,ownership:f.ownership.length,pv:f.moveInfos[0].pv,nnRows:f.nnRowsProcessed,nnBatches:f.nnBatchesProcessed});
  }
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync(`test-results/gpu-${channel}-${size}.json`,JSON.stringify({modelHash,channel,size,summary,runs,logs},null,2));
  console.log(JSON.stringify({modelHash,channel,size,summary},null,2));
} finally {await browser?.close();await new Promise(r=>server.close(r));}
