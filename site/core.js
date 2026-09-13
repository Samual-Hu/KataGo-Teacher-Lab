export const SCHEMA = 'katago-teacher/1.0';
export const DEFAULTS = {maxVisits:100000, maxTimeSec:1800, threads:4, firstVisits:64, growth:1.5, minVisits:1024, window:4, winrateTolerance:0.005, scoreTolerance:0.5, policyTVTolerance:0.035, ownershipTolerance:0.025, pvPrefix:3, autoStop:true, pvLength:64, moveOwnership:true};
export const coord = (i,n) => i < 0 ? 'pass' : 'ABCDEFGHJKLMNOPQRST'[i%n]+(n-Math.floor(i/n));
export function point(s,n) {if(s==='pass')return -1; const x='ABCDEFGHJKLMNOPQRST'.indexOf(s[0]), y=n-Number(s.slice(1)); if(x<0||x>=n||y<0||y>=n)throw Error('坐标超出棋盘');return y*n+x;}
export function validateSettings(s) {
  for(const [k,a,b] of [['maxVisits',1,100000000],['maxTimeSec',1,86400],['threads',1,32],['firstVisits',1,1000000],['minVisits',1,100000000],['window',2,20],['pvLength',1,256],['pvPrefix',1,20]])
    if(!Number.isInteger(s[k])||s[k]<a||s[k]>b)throw Error(`${k} 必须是 ${a}–${b} 之间的整数`);
  for(const [k,a,b] of [['growth',1.1,4],['winrateTolerance',0,1],['scoreTolerance',0,100],['policyTVTolerance',0,1],['ownershipTolerance',0,2]])
    if(!Number.isFinite(s[k])||s[k]<a||s[k]>b)throw Error(`${k} 超出范围`);
  if(s.pvPrefix>s.pvLength)throw Error('PV 稳定前缀不能超过保存长度');
  return s;
}
export function visitDistribution(snapshot) {
  // Symmetry aliases duplicate physical child visits. Never double count them.
  const moves=snapshot.moveInfos.filter(m=>!m.isSymmetryOf);
  const sum=moves.reduce((a,m)=>a+(m.edgeVisits??m.visits),0);
  return Object.fromEntries(moves.map(m=>[m.move,sum?(m.edgeVisits??m.visits)/sum:0]));
}
export function tv(a,b) {const keys=new Set([...Object.keys(a),...Object.keys(b)]);return [...keys].reduce((s,k)=>s+Math.abs((a[k]??0)-(b[k]??0)),0)/2;}
export function convergence(samples,s) {
  const usable=samples.filter(x=>!x.forcedFinal&&x.actualRootVisits>0);
  const w=usable.slice(-s.window), last=w.at(-1);
  const result={stable:false,windowStartVisits:w[0]?.actualRootVisits??null,detectedAtVisits:last?.actualRootVisits??null};
  if(w.length<s.window||last.actualRootVisits<s.minVisits)return {...result,reason:'insufficient-evidence'};
  const best=x=>x.moveInfos.find(m=>m.order===0)??x.moveInfos[0];
  if(w.some((x,i)=>!best(x)||!x.ownership||x.ownership.length!==last.ownership.length||(i&&x.actualRootVisits<=w[i-1].actualRootVisits)))return {...result,reason:'missing-or-stale-data'};
  const b=best(last), ref=visitDistribution(last);
  const spread=k=>Math.max(...w.map(x=>x.rootInfo[k]))-Math.min(...w.map(x=>x.rootInfo[k]));
  const winrateRange=spread('winrate'),scoreRange=spread('scoreLead');
  const maxPolicyTV=Math.max(...w.map(x=>tv(visitDistribution(x),ref)));
  const ownershipMaxDelta=Math.max(...last.ownership.map((_,i)=>Math.max(...w.map(x=>x.ownership[i]))-Math.min(...w.map(x=>x.ownership[i]))));
  const sameBest=w.every(x=>best(x).move===b.move);
  const samePV=b.pv.length>=s.pvPrefix&&w.every(x=>JSON.stringify(best(x).pv.slice(0,s.pvPrefix))===JSON.stringify(b.pv.slice(0,s.pvPrefix)));
  const stable=sameBest&&samePV&&winrateRange<=s.winrateTolerance&&scoreRange<=s.scoreTolerance&&maxPolicyTV<=s.policyTVTolerance&&ownershipMaxDelta<=s.ownershipTolerance;
  return {...result,stable,reason:stable?'observed-stability':'changing',sameBest,samePV,winrateRange,scoreRange,maxPolicyTV,ownershipMaxDelta};
}
export function verifyFinal(samples,s){const final=samples.at(-1);if(!final)return {stable:false,reason:'no-final'};const prior=samples.filter(x=>!x.forcedFinal&&x.actualRootVisits<final.actualRootVisits);return convergence([...prior,{...final,forcedFinal:false}],s);}
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export const plain = value => JSON.parse(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));
export function validateSnapshot(f,n){
  if(!Number.isInteger(f.actualRootVisits)||f.actualRootVisits<1||!f.rootInfo||!f.rootValue||!Array.isArray(f.moveInfos))throw Error('缺少完整搜索统计');
  for(const k of ['winrate','scoreLead','scoreStdev'])if(!Number.isFinite(f.rootInfo[k]))throw Error('搜索统计出现非有限值');
  for(const [k,len] of [['policy',n*n+1],['ownership',n*n],['ownershipStdev',n*n]])if(!Array.isArray(f[k])||f[k].length!==len||f[k].some(v=>!Number.isFinite(v)))throw Error(`${k} 维度或数值无效`);
  for(const m of f.moveInfos){if(typeof m.move!=='string'||!Number.isFinite(m.visits)||!Number.isFinite(m.prior)||!Number.isFinite(m.winrate)||!Number.isFinite(m.scoreLead)||!Array.isArray(m.pv))throw Error('候选着统计不完整');point(m.move,n);}
  return f;
}
export function parseDataset(text){let parsed;try{const p=JSON.parse(text);parsed=Array.isArray(p)?p:[p];}catch{parsed=text.split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x));}
  for(const r of parsed){const n=r.position?.size;if(r.schema!==SCHEMA||typeof r.id!=='string'||typeof r.teacher?.name!=='string'||! /^[a-f0-9]{64}$/.test(r.teacher?.sha256??'')||!Array.isArray(r.snapshots)||!r.settings||![9,13,19].includes(n))throw Error('不兼容或缺少来源信息的记录');
    for(const k of ['board','setup'])if(!Array.isArray(r.position[k])||r.position[k].length!==n*n||r.position[k].some(x=>![0,1,2].includes(x)))throw Error('局面棋盘无效');
    if(!Array.isArray(r.position.moves)||!Number.isFinite(r.position.komi)||![1,2].includes(r.position.toPlay)||![1,2].includes(r.position.initialPla)||typeof r.createdAt!=='string')throw Error('局面历史或日期无效');
    for(const f of r.snapshots)validateSnapshot(f,n);
  }return parsed;
}
export const serializeDataset = records => records.map(r=>JSON.stringify(r)).join('\n')+(records.length?'\n':'');
export function parseSGF(text) {
  let i=0, id=0; const nodes=[];
  const ws=()=>{while(/\s/.test(text[i]??'')&&i<text.length)i++;};
  function value(){let s='';i++;while(i<text.length){let c=text[i++];if(c===']')return s;if(c==='\\'){c=text[i++];if(c==='\r'){if(text[i]==='\n')i++;continue;}if(c==='\n')continue;if(c===undefined)break;}s+=c;}throw Error('SGF 属性未闭合');}
  function tree(parent){ws();if(text[i++]!=='(')throw Error('SGF 缺少 (');ws();let prev=parent,count=0;
    while(text[i]===';'){i++;const node={id:id++,parent:prev,props:{},children:[]};nodes.push(node);if(prev)prev.children.push(node);prev=node;count++;ws();
      while(/[A-Za-z]/.test(text[i]??'')&&i<text.length){let key='';while(/[A-Za-z]/.test(text[i]??'')&&i<text.length)key+=text[i++];ws();const values=[];while(text[i]==='['){values.push(value());ws();}if(!values.length)throw Error('SGF 属性缺少值');node.props[key]=values;}
    }
    if(!count)throw Error('空 SGF 分支');while(text[i]==='('){tree(prev);ws();}if(text[i++]!==')')throw Error('SGF 分支未闭合');ws();
  }
  ws();tree(null);if(i!==text.length)throw Error('请每次上传一盘 SGF（不支持多棋谱集合）');
  const n=Number(nodes[0].props.SZ?.[0]??19);if(![9,13,19].includes(n))throw Error('支持 9、13、19 路棋盘');return {nodes,size:n,text};
}
export function neighbors(i,n){const x=i%n,y=Math.floor(i/n);return [x>0?i-1:-1,x<n-1?i+1:-1,y>0?i-n:-1,y<n-1?i+n:-1].filter(x=>x>=0);}
function group(board,start,n){const color=board[start],stones=new Set([start]),lib=new Set(),queue=[start];for(const p of queue)for(const q of neighbors(p,n)){if(!board[q])lib.add(q);else if(board[q]===color&&!stones.has(q)){stones.add(q);queue.push(q);}}return {stones,lib};}
export function play(board,loc,col,n,history){const next=board.slice();if(loc<0)return next;if(next[loc])throw Error('落子点已有棋子');next[loc]=col;for(const q of neighbors(loc,n)){if(next[q]&&next[q]!==col){const g=group(next,q,n);if(!g.lib.size)for(const p of g.stones)next[p]=0;}}
  const own=group(next,loc,n);if(!own.lib.size){if(own.stones.size===1)throw Error('单子自杀非法');for(const p of own.stones)next[p]=0;}
  if(history?.has(next.join('')))throw Error('违反全局同形禁着');return next;
}
export function sgfPosition(game,nodeId){const node=game.nodes.find(x=>x.id===nodeId);if(!node)throw Error('SGF 节点不存在');const path=[];for(let p=node;p;p=p.parent)path.unshift(p);
  const n=game.size;let board=Array(n*n).fill(0),setup=board.slice(),moves=[],toPlay=1,initialPla=1,resetAt=null,history=new Set([board.join('')]);
  const decode=s=>{if(s===''||s==='tt')return -1;if(!/^[a-s]{2}$/.test(s))throw Error('无效 SGF 坐标');const x=s.charCodeAt(0)-97,y=s.charCodeAt(1)-97;if(x>=n||y>=n)throw Error('SGF 坐标超出棋盘');return y*n+x;};
  function expand(s){if(!s.includes(':'))return [decode(s)];const [a,b]=s.split(':').map(decode),out=[];if(a<0||b<0||a%n>b%n||Math.floor(a/n)>Math.floor(b/n))throw Error('无效摆子范围');for(let y=Math.floor(a/n);y<=Math.floor(b/n);y++)for(let x=a%n;x<=b%n;x++)out.push(y*n+x);return out;}
  for(const p of path){const pr=p.props;if(pr.AB||pr.AW||pr.AE){if(pr.B||pr.W)throw Error('同一节点不能同时摆子和落子');for(const [key,c] of [['AE',0],['AB',1],['AW',2]])for(const v of pr[key]??[])for(const loc of expand(v)){if(loc<0)throw Error('摆子不能停一手');board[loc]=c;}setup=board.slice();moves=[];resetAt=p.id;toPlay=pr.PL?.[0]==='W'||Number(pr.HA?.[0])>1?2:1;initialPla=toPlay;history=new Set([board.join('')]);}
    if(pr.PL){if(!['B','W'].includes(pr.PL[0]))throw Error('无效 PL');toPlay=pr.PL[0]==='B'?1:2;if(!moves.length)initialPla=toPlay;}
    if(pr.B&&pr.W)throw Error('一个节点包含黑白两着');for(const [key,c] of [['B',1],['W',2]])if(pr[key]){if(pr[key].length!==1)throw Error('无效着手数');if(c!==toPlay)throw Error(`节点 ${p.id} 行棋方不一致`);const loc=decode(pr[key][0]);board=play(board,loc,c,n,history);history.add(board.join(''));moves.push({loc,col:c});toPlay=3-c;}
  }
  const komi=Number(game.nodes[0].props.KM?.[0]??7.5);if(!Number.isFinite(komi))throw Error('无效贴目');return {size:n,board,setup,moves,toPlay,initialPla,komi,rules:'tromp-taylor',historyResetAtNode:resetAt,sgfNode:node.id,sgfPath:path.map(x=>x.id),sourceRules:game.nodes[0].props.RU?.[0]??null};
}
