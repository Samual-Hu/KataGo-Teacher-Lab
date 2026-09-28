import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../site/diagnostics.js';
const {report}=globalThis.KataDiagnostics;
test('non-enumerable Error message, stack and nested causes survive serialization',()=>{
  const cause=new Error('nnXLen=9, board=19');
  const e=new Error('search failed',{cause});
  const r=JSON.parse(JSON.stringify(report(e,{phase:'kgeSearchBegin',size:9})));
  assert.equal(r.message,'nnXLen=9, board=19');
  assert.match(r.exception.stack,/search failed/);
  assert.match(r.exception.cause.stack,/nnXLen=9/);
  assert.equal(r.context.size,9);
});
test('ErrorEvent fields and its actual error are retained',()=>{
  const r=report({message:'Uncaught [object Object]',error:new Error('native failure'),filename:'engine.js',lineno:10,colno:20});
  assert.equal(r.message,'native failure');assert.equal(r.exception.lineno,10);assert.match(r.exception.error.stack,/native failure/);
});
test('objects, numeric C++ pointers, circular properties and throwing getters cannot break reporting',()=>{
  const e={excPtr:1234,info:'native exception'};e.self=e;
  Object.defineProperty(e,'bad',{get(){throw Error('getter');}});
  const r=report(e,{recentLogs:['one','two']});
  assert.match(r.message,/1234/);assert.equal(r.exception.self,'[Circular]');assert.match(r.exception.bad,/Unreadable/);
  assert.deepEqual(r.context.recentLogs,['one','two']);assert.equal(report(1234).exception,1234);
});
test('opaque cross-worker events retain evidence without a meaningless object headline',()=>{
  const r=report({message:'Uncaught [object Object]',error:null,filename:'kataeval-mt.js',lineno:1});
  assert.doesNotMatch(r.message,/\[object Object\]/);assert.equal(r.exception.message,'Uncaught [object Object]');assert.equal(r.exception.filename,'kataeval-mt.js');
});
