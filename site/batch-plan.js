import {sgfPosition,SCHEMA,plain,sha256,serializeDataset} from './core.js';

export function batchPlan(game) {
  if(!game?.nodes?.length)throw Error('请先导入 SGF 棋谱');
  if(game.nodes[0].props.B||game.nodes[0].props.W)throw Error('请使用有独立根节点的 SGF；根节点不应直接落子');
  const nodes=[];for(let node=game.nodes[0];node;node=node.children[0])if(node===game.nodes[0]||node.props.B||node.props.W)nodes.push(node);
  if(nodes.length<2)throw Error('棋谱第一主线没有着手');
  return nodes.map((node,ply)=>({ply,nodeId:node.id,position:sgfPosition(game,node.id)}));
}
export async function createBatchRecord({batchId,entry,total,teacher,engine,sourceSGF,settings}) {
  const position=plain(entry.position);
  return {schema:SCHEMA,id:crypto.randomUUID(),createdAt:new Date().toISOString(),state:'running',teacher:plain(teacher),engine:plain(engine),
    position,positionSha256:await sha256(new TextEncoder().encode(JSON.stringify(position))),sourceSGF:plain(sourceSGF),settings:plain(settings),
    sequence:{batchId,ply:entry.ply,nodeId:entry.nodeId,total,mainline:true},notes:`整盘自动分析 · 第 ${entry.ply} / ${total-1} 手`,snapshots:[],
    conventions:{perspective:'white',policy:'raw NN prior; pass last',visits:'actualRootVisits and per-candidate edgeVisits',searchTree:'fresh per position',precision:'fp32'}};
}
export function finishBatchRecord(record,result) {
  const final=record.snapshots.at(-1);
  if(!final?.forcedFinal||!Number.isInteger(final.actualRootVisits)||final.actualRootVisits<1)throw Error('局面缺少最终完整教师快照');
  record.state='complete';record.result={...result};delete record.result.type;record.completedAt=new Date().toISOString();
  return record;
}
export function batchJsonl(records){return serializeDataset(records);}
