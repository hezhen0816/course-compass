import test from 'node:test';
import assert from 'node:assert/strict';
import { historyCourses, initialSuite, allHistory, passedCredits, weightedScore, gradeEstimate, restoreSuite } from './suite-model.js';
test('failed attempts remain in history but do not earn graduation credits',()=>{
  assert.equal(passedCredits(historyCourses),28);
  assert.equal(passedCredits(historyCourses.filter(c=>c.name==='離散數學')),3);
  assert.ok(weightedScore(historyCourses)<weightedScore(historyCourses.filter(c=>c.status==='已通過')));
});
test('applying the sample import once updates credits without duplication',()=>{
  const state={...initialSuite,imported:true};
  assert.equal(passedCredits(allHistory(state)),30);
  assert.equal(allHistory(state).filter(c=>c.id==='import1').length,1);
  assert.equal(passedCredits(allHistory(initialSuite)),28);
});
test('grade estimate requires complete scores and a 100 percent weight total',()=>{
  assert.equal(gradeEstimate([{weight:30,score:80},{weight:30,score:90},{weight:40,score:100}]).value,91);
  assert.equal(gradeEstimate([{weight:100,score:''}]).value,null);
  assert.equal(gradeEstimate([{weight:80,score:90}]).value,null);
  assert.equal(gradeEstimate([{weight:100,score:101}]).value,null);
});
test('suite restoration rejects invalid shapes and preserves empty plans',()=>{
  assert.deepEqual(restoreSuite({getItem:()=>'{oops'}),initialSuite);
  const restored=restoreSuite({getItem:()=>JSON.stringify({future:[],notes:null,tracking:['BA303','BA303',5],target:-1})});
  assert.deepEqual(restored.future,[]);assert.deepEqual(restored.notes,{});assert.deepEqual(restored.tracking,['BA303']);assert.equal(restored.target,128);
});
