import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseSGF,validateSettings,parseDataset,DEFAULTS} from '../site/core.js';
import {batchPlan,createBatchRecord,finishBatchRecord,batchJsonl} from '../site/batch-plan.js';

test('mainline includes the initial position and each first-branch move with full history',()=>{
  const game=parseSGF('(;SZ[9]KM[7.5];B[dd];W[ee](;B[ff])(;B[gg]))');
  const line=batchPlan(game);
  assert.equal(line.length,4);assert.deepEqual(line.map(x=>x.ply),[0,1,2,3]);
  assert.deepEqual(line.map(x=>x.position.moves.length),[0,1,2,3]);
  assert.equal(line.at(-1).position.board[5*9+5],1);
  assert.equal(line.at(-1).position.board[6*9+6],0);
});
test('every exported position carries teacher identity, search settings, position hash and final visits',async()=>{
  const game=parseSGF('(;SZ[9]KM[7.5];B[dd])'),entry=batchPlan(game)[1];
  const settings=validateSettings({...DEFAULTS,maxVisits:128,threads:64});
  const record=await createBatchRecord({batchId:'run-1',entry,total:2,teacher:{name:'b18',sha256:'a'.repeat(64)},engine:{revision:'test'},sourceSGF:{fileName:'test.sgf',text:game.text,sha256:'b'.repeat(64)},settings});
  record.snapshots.push({forcedFinal:true,actualRootVisits:131,rootInfo:{winrate:.5,scoreLead:0,scoreStdev:1},rootValue:{},moveInfos:[],policy:Array(82).fill(0),ownership:Array(81).fill(0),ownershipStdev:Array(81).fill(0)});
  finishBatchRecord(record,{reason:'budget-exhausted',actualVisits:131});
  const [roundTrip]=parseDataset(batchJsonl([record]));
  assert.equal(roundTrip.teacher.sha256,'a'.repeat(64));assert.equal(roundTrip.settings.threads,64);
  assert.equal(roundTrip.positionSha256.length,64);assert.equal(roundTrip.sequence.ply,1);
  assert.equal(roundTrip.result.actualVisits,131);assert.equal(roundTrip.snapshots[0].forcedFinal,true);
});
